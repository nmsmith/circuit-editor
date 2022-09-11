<script lang="ts">
   export let label: string
   export let isHeld: boolean
   export let shouldBind: boolean | undefined
   export let isBound: boolean
   let className: string
   $: {
      className = "button"
      if (isHeld) className += " isHeld"
      if (shouldBind) className += " shouldBind"
      if (isBound) className += " isBound"
   }
</script>

<div class={className} on:mousedown>
   <div class="capital">{label[0]}</div>
   <div class="rest">{label.slice(1)}</div>
</div>

<style>
   .button {
      background-color: rgb(231, 234, 237);
      white-space: nowrap;
      user-select: none;
      -webkit-user-select: none;
   }
   .isHeld {
      background-color: rgb(220, 220, 220);
      box-shadow: 1px 1px 2px 1px #00000088 inset;
      padding-left: 1px;
      padding-top: 1px;
   }
   .isBound {
      background-color: rgb(255, 252, 170);
   }
   .capital {
      display: inline;
      padding-left: 2px;
      margin-right: -3px;
      font: bold 18px "Courier", monospace;
   }
   .rest {
      display: inline;
      font: 11px "Monaco", monospace;
   }
</style>
