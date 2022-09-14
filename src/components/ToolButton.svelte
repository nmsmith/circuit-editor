<script lang="ts">
   export let label: string
   export let isSelected: boolean
   export let isHeld: boolean
   export let isBound: boolean
   let className: string
   $: {
      className = "button"
      if (isSelected) className += " isSelected"
      if (isHeld) className += " isHeld"
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
      border-radius: 3px;
      white-space: nowrap;
      user-select: none;
      -webkit-user-select: none;
   }
   .isHeld,
   .button:active {
      box-shadow: 1px 1px 2px 0px #00000077 inset;
      padding-left: 1px;
      padding-top: 1px;
   }
   /* .isBound {
      background-color: rgb(214, 212, 169);
   } */
   .isSelected {
      background-color: rgb(255, 250, 120);
   }
   .capital {
      display: inline;
      padding-left: 3px;
      margin-right: -3px;
      font: bold 18px "Courier", Courier, monospace;
   }
   .rest {
      display: inline;
      font-family: "Fira Code", monospace;
      font-size: 12px;
      font-weight: 400;
   }
</style>
