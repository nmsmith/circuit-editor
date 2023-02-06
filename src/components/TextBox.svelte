<script lang="ts">
   export let width = 86
   export let text: string
   export let shouldFocus: boolean = false
   export let onFocus: () => void = () => {}
   export let onSubmit: (value: string) => void = () => {}

   let shouldSubmit = true

   function keydown(this: HTMLInputElement, event: KeyboardEvent) {
      if (event.key === "Enter" || event.key === "Tab") {
         this.blur()
      } else if (event.key === "Escape") {
         shouldSubmit = false
         this.blur()
      }
   }
   function onFocus_(this: HTMLInputElement) {
      this.value = text
      shouldSubmit = true
      onFocus()
   }
   function onBlur(this: HTMLInputElement) {
      if (shouldSubmit) onSubmit(this.value)
      this.value = ""
   }
   function change(node: HTMLInputElement, focus: boolean): any {
      if (focus) {
         node.focus()
         node.select()
      }
      return {
         // Svelte calls this returned "update" function whenever the element is
         // modified. When this happens, we just call "change" again.
         update: (focus_: boolean) => change(node, focus_),
      }
   }
</script>

<div class="textBox" style="width: {width}px">
   <div class="submittedText">{text}</div>
   <input
      type="text"
      class="textBoxInput"
      on:keydown={keydown}
      on:focus={onFocus_}
      on:blur={onBlur}
      use:change={shouldFocus}
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
