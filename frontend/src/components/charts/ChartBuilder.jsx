import { memo, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/states/EmptyState"
import { queryChartData } from "@/lib/api"
import {
  AGGREGATIONS,
  CHART_TYPES,
  coerceConfigForType,
  defaultChartConfig,
  describePrepared,
  getDimensionOptions,
  getMeasureOptions,
  transformChartData,
  validateChartConfig,
} from "@/lib/chart-data"
import {
  adaptServerChartToPrepared,
  buildChartRequest,
  buildChartRequestKey,
  clearChartCache,
  describeServerPrepared,
  getCachedChart,
  isChartRequestComplete,
  setCachedChart,
  shouldUseServerChart,
} from "@/lib/chart-data-source"
import { buildServerFilterKey, toServerFilters } from "@/lib/filter-data"
import {
  getDatasetId,
  isExpiredDatasetError,
} from "@/lib/dataset-source"
import { FieldSelect } from "@/components/charts/FieldSelect"
import { IosHapticSwitch } from "@/components/haptics/IosHapticSwitch"
import { useMetriviaHaptics } from "@/hooks/useMetriviaHaptics"
import { AreaChartView } from "@/components/charts/views/AreaChartView"
import { BarChartView } from "@/components/charts/views/BarChartView"
import { LineChartView } from "@/components/charts/views/LineChartView"
import { PieChartView } from "@/components/charts/views/PieChartView"
import { ScatterChartView } from "@/components/charts/views/ScatterChartView"

const VIEW_BY_TYPE = {
  bar: BarChartView,
  line: LineChartView,
  area: AreaChartView,
  pie: PieChartView,
  scatter: ScatterChartView,
}

const EXPIRED_TITLE = "This dataset session has expired"
const EXPIRED_MESSAGE = "This dataset session has expired. Please upload the CSV again."

/**
 * Interactive chart builder: configuration state lives here and every
 * change re-renders from the already-uploaded dataset — no re-upload.
 * Defaults to a sensible bar chart (dimension + numeric measure + Sum)
 * when the dataset supports it.
 *
 * Two data sources (Phase M4):
 * - local/full-preview: small datasets aggregate the complete preview in
 *   React via `transformChartData`, exactly as before (no Flask requests).
 * - server/aggregated: large datasets POST the chart config + canonical
 *   `toServerFilters()` output to /api/datasets/<id>/chart, which applies
 *   the M3 filter mask over the FULL server-side DataFrame and returns a
 *   small bounded payload. The existing Bklit views render either source
 *   unchanged (the server payload adapts to the same `prepared` shape).
 *
 * `dataset` is the filtered view (local path input, as before).
 * `sourceDataset` is the original upload payload — server-backed detection
 * must use it (filtering shrinks the view's preview, which would falsely
 * look server-backed). `filters` is the UI filter state for server
 * requests. All three are optional for backward compatibility.
 *
 * Server request lifecycle (same patterns as the table): AbortController,
 * request identity over dataset id + chart config + filter identity, cache
 * identity including every field, workspace/dataset switches abort
 * in-flight requests and never leak data across workspaces. Loading and
 * errors stay chart-local (aria-live region, no layout shift, no global
 * loader, no artificial delays).
 *
 * `dataset` may be a filtered view: the configuration only resets when the
 * underlying file changes (tracked by filename), so adjusting filters
 * never wipes the user's chart setup. `emptyAction` (e.g. a Clear filters
 * button) renders inside the empty state when the current view has no rows.
 *
 * Workspace mode (Phase C): pass `config` + `onConfigChange` to lift the
 * configuration into the workspace store so it survives tab switches and
 * view navigation. The parent then owns resets (fresh defaults on upload);
 * the filename reset effect below only runs in uncontrolled mode. When the
 * props are absent the builder keeps its original local state untouched.
 *
 * Memoized (Phase E): the builder sits inside the dashboard tree, so parent
 * renders for unrelated reasons (table scroll state, header) must not
 * replay chart animations. Props are referentially stable by contract.
 */
export const ChartBuilder = memo(function ChartBuilder({
  dataset,
  sourceDataset = null,
  filters = null,
  emptyAction = null,
  config: controlledConfig,
  onConfigChange,
}) {
  const [localConfig, setLocalConfig] = useState(() =>
    defaultChartConfig(dataset),
  )
  const controlled =
    controlledConfig !== undefined && typeof onConfigChange === "function"
  // Controlled configs are always objects (the workspace store seeds fresh
  // defaults); fall back to local state defensively so render never crashes.
  const config = controlled ? (controlledConfig ?? localConfig) : localConfig
  const setConfig = (updater) => {
    if (controlled) {
      onConfigChange(
        typeof updater === "function" ? updater(config) : updater,
      )
    } else {
      setLocalConfig(updater)
    }
  }
  const { chartSelect } = useMetriviaHaptics()

  // A new upload replaces the file: restart from fresh defaults. Filter
  // changes only swap the dataset object, so they must not reset config.
  // Skipped in workspace mode — the workspace sets defaults on upload.
  const datasetKey = dataset?.filename ?? null
  useEffect(() => {
    if (controlled) return
    setConfig(defaultChartConfig(dataset))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetKey])

  // Option lists depend only on the dataset *schema* (columns, inferred
  // types, unique counts) — never on the row values. They are keyed on
  // those stable references (Phase G) so filtering rows (which replaces
  // the dataset object via buildFilteredDataset while keeping the same
  // column/type metadata) does not recompute them or hand new arrays to
  // the selects. Only an actual schema change (new upload) recalculates.
  const schemaColumns = dataset?.columns
  const schemaDtypes = dataset?.dtypes
  const schemaUnique = dataset?.unique
  const dimensionOptions = useMemo(
    () => getDimensionOptions(dataset, config.chartType),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schemaColumns, schemaDtypes, schemaUnique, config.chartType],
  )
  const measureOptions = useMemo(
    () => getMeasureOptions(dataset),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schemaColumns, schemaDtypes],
  )

  // --- Phase M4 server path identity -------------------------------------
  // Detection uses the ORIGINAL dataset (the filtered view's preview
  // shrinks under filters and would falsely read as server-backed).
  const schemaDataset = sourceDataset ?? dataset
  const serverBacked = shouldUseServerChart(schemaDataset)
  const datasetId = getDatasetId(schemaDataset)
  const serverFilters = useMemo(
    () => (serverBacked ? toServerFilters(filters) : []),
    [serverBacked, filters],
  )
  const filterKey = useMemo(
    () => (serverBacked ? buildServerFilterKey(serverFilters) : ""),
    [serverBacked, serverFilters],
  )
  const chartRequest = useMemo(
    () => (serverBacked ? buildChartRequest(config, serverFilters) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      serverBacked,
      config.chartType,
      config.dimension,
      config.measure,
      config.aggregation,
      filterKey,
    ],
  )
  const requestKey = useMemo(
    () =>
      serverBacked && chartRequest
        ? buildChartRequestKey(datasetId, chartRequest)
        : "",
    [serverBacked, datasetId, chartRequest],
  )
  const requestComplete =
    serverBacked && chartRequest
      ? isChartRequestComplete(chartRequest)
      : false
  // Config-shape validation against the schema (sample preview is non-empty
  // server-side, so only unsuitable dimension/measure/type combinations
  // surface here — no doomed requests, same instructional copy as local).
  const serverConfigValidity = useMemo(
    () =>
      serverBacked ? validateChartConfig(schemaDataset, config) : { ok: true },
    [serverBacked, schemaDataset, config],
  )

  // --- Server request state (unused in local mode) -------------------------
  const [serverPrepared, setServerPrepared] = useState(null)
  const [serverStatus, setServerStatus] = useState("idle")
  const [serverError, setServerError] = useState(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const requestIdRef = useRef(0)
  const abortRef = useRef(null)
  const datasetIdRef = useRef(datasetId)
  const requestKeyRef = useRef(requestKey)

  // Workspace/dataset/config/filter lifecycle: a new identity abandons the
  // in-flight request, serves the bounded cache when possible, and fetches
  // otherwise. The cache key covers dataset id + full chart config + filter
  // identity, so workspace A data can never render in workspace B and stale
  // responses can never overwrite newer state (guarded by request id + key).
  useEffect(() => {
    if (!serverBacked || datasetId == null) return
    if (!requestComplete || !serverConfigValidity.ok) return
    if (datasetIdRef.current !== datasetId) {
      datasetIdRef.current = datasetId
      requestKeyRef.current = null
      setServerPrepared(null)
      setServerError(null)
    }
    if (requestKeyRef.current === requestKey) return
    requestKeyRef.current = requestKey
    const cached = getCachedChart(requestKey)
    if (cached) {
      setServerPrepared(cached)
      setServerStatus("ready")
      setServerError(null)
      return
    }
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    const activeDatasetId = datasetId
    const activeKey = requestKey
    const body = { ...chartRequest, filters: [...chartRequest.filters] }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setServerStatus("loading")
    setServerError(null)
    queryChartData(activeDatasetId, body, { signal: controller.signal }).then(
      (response) => {
        if (requestIdRef.current !== requestId) return
        if (datasetIdRef.current !== activeDatasetId) return
        if (requestKeyRef.current !== activeKey) return
        const prepared = adaptServerChartToPrepared(response, config)
        setCachedChart(activeKey, prepared)
        setServerPrepared(prepared)
        setServerStatus("ready")
      },
      (err) => {
        if (requestIdRef.current !== requestId) return
        if (datasetIdRef.current !== activeDatasetId) return
        if (requestKeyRef.current !== activeKey) return
        if (err?.name === "AbortError" || controller.signal.aborted) return
        setServerStatus("error")
        setServerError(err)
      },
    )
    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBacked, datasetId, requestKey, retryNonce, requestComplete])

  // Abandon any in-flight chart request on unmount (workspace close).
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  // Local path (small datasets, unchanged behavior).
  const prepared = useMemo(
    () => (serverBacked ? null : transformChartData(dataset, config)),
    [serverBacked, dataset, config],
  )

  const isScatter = config.chartType === "scatter"
  const isCount = config.aggregation === "count"
  const ChartView = VIEW_BY_TYPE[config.chartType] ?? BarChartView

  // Discrete chart-type change only: re-selecting the active type is a
  // no-op state-wise (aria-pressed is already true), so it stays silent.
  const handleChartTypeChange = (typeId) => {
    if (typeId === config.chartType) return
    chartSelect()
    setConfig((prev) => coerceConfigForType(dataset, prev, typeId))
  }

  const handleRetry = () => {
    if (requestKeyRef.current != null) {
      // Drop the failed entry shape (cache only holds successes) and refetch.
      requestKeyRef.current = null
    }
    setRetryNonce((n) => n + 1)
  }

  const renderServerState = () => {
    if (!serverConfigValidity.ok) {
      return (
        <EmptyState
          title={serverConfigValidity.title}
          description={serverConfigValidity.message}
        />
      )
    }
    if (!requestComplete) {
      return (
        <EmptyState
          title="Configure this chart"
          description="Pick a dimension and measure above to aggregate the full dataset."
        />
      )
    }
    if (serverStatus === "error") {
      const expired = isExpiredDatasetError(serverError)
      if (expired) {
        return (
          <EmptyState title={EXPIRED_TITLE} description={EXPIRED_MESSAGE} />
        )
      }
      const validationError =
        serverError != null &&
        Number(serverError?.status) >= 400 &&
        Number(serverError?.status) < 500
      return (
        <div className="flex min-w-0 flex-col gap-2">
          <EmptyState
            title={
              validationError
                ? "Could not build this chart"
                : "Could not load the chart"
            }
            description={
              validationError
                ? (serverError?.message || "The chart configuration is not valid for this dataset.")
                : (serverError?.message || "Please try again.")
            }
            action={
              validationError ? null : (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Retry
                </button>
              )
            }
          />
        </div>
      )
    }
    if (serverStatus === "loading" || serverPrepared === null) {
      return (
        <div className="flex min-h-64 min-w-0 items-center justify-center">
          <p role="status" className="text-sm text-muted-foreground">
            Loading chart…
          </p>
        </div>
      )
    }
    if (serverPrepared.status !== "ok") {
      const noRows = serverPrepared.title === "No rows match the current filters"
      return (
        <EmptyState
          title={serverPrepared.title}
          description={serverPrepared.message}
          action={noRows ? emptyAction : null}
        />
      )
    }
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <ChartView data={serverPrepared.data} />
        <p className="text-xs break-words text-muted-foreground">
          {describeServerPrepared(serverPrepared)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="px-0 text-xs font-medium text-muted-foreground">
          Chart type
        </legend>
        <div className="flex min-w-0 flex-wrap gap-1.5" role="group" aria-label="Chart type">
          {CHART_TYPES.map((type) => (
            <button
              key={type.id}
              type="button"
              aria-pressed={config.chartType === type.id}
              onClick={() => handleChartTypeChange(type.id)}
              className={cn(
                "relative h-9 shrink-0 rounded-lg border px-3.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                config.chartType === type.id
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {type.label}
              {/* iOS direct-touch haptic only on actionable (inactive)
                  types: re-tapping the active type stays silent. Null on
                  Android/desktop. */}
              {config.chartType !== type.id ? (
                <IosHapticSwitch
                  onActivate={() => handleChartTypeChange(type.id)}
                />
              ) : null}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FieldSelect
          id="chart-dimension"
          label={isScatter ? "X axis (datetime)" : "Dimension"}
          value={config.dimension}
          options={dimensionOptions}
          onChange={(value) =>
            setConfig((prev) => ({ ...prev, dimension: value }))
          }
          hint={
            dimensionOptions.length === 0
              ? `No suitable ${isScatter ? "datetime" : "grouping"} columns in this dataset.`
              : null
          }
        />
        <FieldSelect
          id="chart-measure"
          label={isScatter ? "Y axis (numeric)" : "Measure"}
          value={config.measure}
          options={measureOptions}
          disabled={isCount && !isScatter}
          onChange={(value) =>
            setConfig((prev) => ({ ...prev, measure: value }))
          }
          hint={
            isCount && !isScatter
              ? "Count uses record counts — no measure needed."
              : null
          }
        />
        {isScatter ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs break-words text-muted-foreground sm:col-span-2 lg:col-span-1">
            Scatter plots show individual row observations — no aggregation is
            applied.
          </p>
        ) : (
          <FieldSelect
            id="chart-aggregation"
            label="Aggregation"
            value={config.aggregation}
            options={AGGREGATIONS.map((a) => ({ value: a.id, label: a.label }))}
            onChange={(value) =>
              setConfig((prev) => ({ ...prev, aggregation: value ?? "sum" }))
            }
          />
        )}
      </div>

      <div aria-live="polite" className="min-w-0">
        {serverBacked ? (
          renderServerState()
        ) : (dataset?.preview ?? []).length === 0 ? (
          <EmptyState
            title="No rows match the current filters"
            description="The active filters removed every row. Clear them to restore the full dataset — your chart configuration is kept."
            action={emptyAction}
          />
        ) : prepared.status === "ok" ? (
          <div className="flex min-w-0 flex-col gap-2">
            <ChartView data={prepared.data} />
            <p className="text-xs break-words text-muted-foreground">
              {describePrepared(prepared)}
            </p>
          </div>
        ) : (
          <EmptyState title={prepared.title} description={prepared.message} />
        )}
      </div>
    </div>
  )
})

// Exported for tests: reset the module-level chart cache between cases.
export function __clearChartCacheForTests() {
  clearChartCache()
}
