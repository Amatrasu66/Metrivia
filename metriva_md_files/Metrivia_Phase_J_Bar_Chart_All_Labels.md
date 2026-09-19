# Metrivia Phase J --- Fix Missing Bar-Chart Category Labels

## Objective

Fix the bar-chart x-axis labels so every displayed bar/category has a
visible corresponding category label when the number of categories is
manageable.

The current production screenshot shows about 20 categories, but only
some category labels are visible below the bars. Hovering a bar reveals
its information, so the data exists; the x-axis is suppressing some
labels.

Do not remove the tooltip. Do not change the underlying chart data.

## 1. Bklit finding

The official Bklit Bar Chart documentation states that `BarXAxis` has:

-   `showAllLabels: boolean`, default `false`
-   `maxLabels: number`, default `12`

Bklit describes `showAllLabels` as showing all labels, with a warning
that they may crowd, and `maxLabels` as the maximum labels to show.

Official docs: - https://bklit.com/docs/components/bar-chart -
https://bklit.com/docs/utility/use-chart

Therefore the current behavior is consistent with Bklit's default
label-suppression policy when there are more categories than the
configured limit.

Do not replace Bklit.

## 2. Inspect the actual Metrivia implementation

Inspect the real:

-   `BarChartView.jsx`
-   shared chart components
-   `BarChart`
-   `BarXAxis`
-   chart-data transformation
-   responsive configuration
-   label formatting/truncation
-   `maxLabels`
-   `showAllLabels`
-   CSS that may hide/fade axis labels

Determine exactly why the screenshot hides labels.

Do not guess.

## 3. Desired behavior

For a vertical bar chart:

-   1--20 categories: show all labels when readable.
-   The current 20-category example must show all 20 category labels on
    desktop.

Do not silently hide labels because Bklit's default `maxLabels=12` is
active.

## 4. Use Bklit's supported API

Prefer Bklit's existing API, for example:

``` jsx
<BarXAxis showAllLabels />
```

or an appropriate `maxLabels` value.

Use the actual installed API.

Do not: - replace `BarXAxis` - modify Bklit source - replace Bklit with
Recharts/another library - recreate the x-axis from scratch unless the
installed Bklit API genuinely cannot satisfy the requirement

## 5. Readability

Test:

-   4 categories
-   8 categories
-   12 categories
-   15 categories
-   20 categories
-   25+ categories

For \~20 categories, make all labels visible while keeping them
reasonably readable.

Do not shrink text excessively.

Do not allow severe overlap.

If needed, use the least invasive Bklit-supported configuration.

Possible strategies, in order:

1.  `showAllLabels`
2.  appropriate `maxLabels`
3.  responsive configuration
4.  horizontal bar layout for very high counts only if compatible with
    the existing UX

Do not automatically change orientation.

## 6. Responsive behavior

Test:

Desktop: - 1440px - 1366px - 1280px

Mobile: - 430px - 390px

Prevent:

-   horizontal page overflow
-   clipped labels
-   unreadable collisions
-   broken card height
-   broken tooltip positioning

If all labels cannot reasonably fit on mobile, implement an intentional
responsive strategy rather than simply hiding them with no alternative.

## 7. Long category names

Test:

-   Alternative Rock
-   Electronic Dance Music
-   Hip-Hop
-   R&B
-   Classical
-   Afrobeats

Do not alter the underlying category values.

If visual shortening is required, preserve the full category in tooltip
and accessible text.

## 8. Hover behavior

Preserve the current Bklit tooltip.

Hovering a bar must continue to show:

-   full category
-   actual value
-   correct bar

Do not create a second tooltip system unless the current one is
demonstrably insufficient.

## 9. Accessibility

Every category must remain discoverable where the chart implementation
supports keyboard/assistive interaction.

If a visual label is shortened, preserve its full accessible name.

Do not rely only on color.

## 10. Performance

Do not add per-label expensive calculations.

Do not add Motion wrappers or label animations.

Preserve existing Bklit chart animation behavior.

## 11. Scope

This phase is specifically for the bar chart.

Do not modify unrelated systems:

-   pie chart
-   line chart
-   area chart
-   scatter chart
-   themes
-   upload/CSV backend
-   workspace system
-   gzip response
-   haptics
-   dashboard architecture

Only modify shared chart utilities if necessary for this bar-label fix.

## 12. Tests

Add/update tests for:

-   4 categories → all visible

-   8 categories → all visible

-   12 categories → all visible

-   20 categories → all visible

-   20 categories → documented responsive/max-label behavior

-   long labels remain identifiable

-   tooltip still contains the full category

-   no horizontal overflow

-   existing chart configuration remains intact

Run:

``` bash
npm run lint
npm run build
npm run themes:test
npm run ui:audit
npm run haptics:audit
npm run workspaces:test
```

Run any existing chart-specific tests.

Do not report tests that were not actually executed.

## 13. Manual test

Use the same 20-category dataset from the screenshot.

Verify:

1.  every bar has a corresponding visible category label
2.  labels align with the correct bars
3.  no label is shifted
4.  hovering each bar shows the correct tooltip
5.  long labels remain understandable
6.  1440px works
7.  1280px works
8.  430px works
9.  390px works
10. no horizontal page overflow

## 14. Final report

Report:

1.  Files changed.
2.  Files added.
3.  Files removed.
4.  Root cause of missing labels.
5.  Exact Bklit API/configuration used.
6.  Category-count behavior.
7.  Responsive behavior.
8.  Long-label behavior.
9.  Accessibility behavior.
10. Test results.
11. Manual verification results.
12. Remaining P2/P3 chart issues.

Explicitly answer:

``` text
Was the original behavior caused by Metrivia or Bklit's default label policy?
```

Base the answer on the actual implementation inspected.

## Success criteria

-   20-category bar chart shows all category labels on desktop when
    readable.
-   Every label corresponds to the correct bar.
-   Hover tooltip remains correct.
-   Long labels remain identifiable.
-   Mobile does not break or horizontally scroll.
-   Bklit's supported API is used.
-   No chart library is replaced.
-   No unrelated functionality regresses.
-   All existing tests pass.
