<script lang="ts">
   export let width = 86
   export let text: string
   export let onSubmit: (value: string) => void = () => {}

   let input: HTMLInputElement
   let shouldSubmit = true

   function keydown(event: KeyboardEvent) {
      if (event.key === "Enter" || event.key === "Tab") {
         input.blur()
      } else if (event.key === "Escape") {
         shouldSubmit = false
         input.blur()
      }
   }
   function focus() {
      input.value = text
      shouldSubmit = true
   }
   function blur() {
      if (shouldSubmit) onSubmit(input.value)
      input.value = ""
   }
</script>

<div class="textBox" style="width: {width}px">
   <div class="submittedText">{text}</div>
   <input
      type="text"
      class="textBoxInput"
      bind:this={input}
      on:keydown={keydown}
      on:focus={focus}
      on:blur={blur}
   />
</div>

<style>
   .textBox {
      position: relative; /*Sets an origin for the position:absolute elements.*/
      height: 1em;
      padding: 2px 3px;
      border: 1px solid #222;
      margin: 1px;
   }
   .textBox:focus-within {
      color: transparent; /* inherited by the child text */
      border-width: 2px;
      margin: 0px;
   }
   .textBox:hover {
      background-color: #fff3;
   }
   .submittedText {
      position: absolute;
      color: inherit;
   }
   input {
      position: absolute;
      width: 100%;
      height: 1em;
      padding: 0px;
      box-sizing: border-box;
      border: none;
      background-color: transparent;
      color: transparent;
   }
   input:focus {
      outline: none;
      color: black;
   }
</style>
