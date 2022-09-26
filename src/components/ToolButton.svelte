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
   <div class="label">{label}</div>
</div>

<style>
   .button {
      background-color: rgb(231, 234, 237);
      border-radius: 3px;
      white-space: nowrap;
      user-select: none;
      -webkit-user-select: none;
      padding: 3px;
      padding-top: 2px;
   }
   .isHeld,
   .button:active {
      box-shadow: 1px 1px 2px 0px #00000077 inset;
      padding-left: 4px;
      padding-top: 3px;
   }
   /* .isBound {
      background-color: rgb(214, 212, 169);
   } */
   .isSelected {
      background-color: rgb(255, 250, 120);
   }
   .label::first-letter {
      font-family: "Courier", Courier, monospace;
      font-size: 18px;
      font-weight: bold;
   }
   .label {
      font-family: "Nunito";
      font-size: 14.5px;
      font-weight: 470;
      letter-spacing: 0.4px;
   }
</style>
