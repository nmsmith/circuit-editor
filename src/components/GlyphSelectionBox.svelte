<script lang="ts">
   import { SymbolKind } from "~/shared/circuit"
   type GlyphKind = "auto" | null | SymbolKind

   export let glyphsToShow: GlyphKind[]
   export let glyphsToHighlight: Set<GlyphKind>
   export let glyphSelected: (kind: GlyphKind) => void
</script>

<div class="glyphSelectionBox">
   {#each glyphsToShow as kind}
      {@const kindText =
         kind === "auto"
            ? "auto"
            : kind === null
            ? "nothing"
            : kind.fileName.replace(".svg", "")}
      {@const highlightClass = glyphsToHighlight.has(kind)
         ? glyphsToHighlight.size === 1
            ? "uniqueHighlight"
            : "multiHighlight"
         : ""}
      <div
         class="glyphSelectionItem {highlightClass}"
         on:click={() => glyphSelected(kind)}
      >
         <div class="glyphLabel">{kindText}</div>
         {#if kind instanceof SymbolKind}
            <svg
               class="glyphImage"
               viewBox="{kind.svgBox.x.low} {kind.svgBox.y
                  .low} {kind.svgBox.width()} {kind.svgBox.height()}"
            >
               <use href="#{kind.fileName}" />
            </svg>
         {:else}
            <div class="glyphImage" />
         {/if}
      </div>
   {/each}
</div>

<style>
   .glyphSelectionBox {
      max-height: 120px;
      overflow-y: scroll;
      /* box-shadow: inset 0 1px 3px 0 rgba(0, 0, 0, 0.4); */
      border: 1px solid grey;
      /* padding: 3px 0; */
   }
   .glyphSelectionItem {
      padding: 3px 5px;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 7px;
   }
   .glyphImage {
      width: 12px;
      min-height: 12px;
   }
   .glyphLabel {
      flex-grow: 1;
   }
</style>
