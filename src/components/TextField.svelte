<script lang="ts">
   export let width = 86
   export let text: string
   export let textCompletion: Iterable<string> | null = null
   export let autoFocus: boolean = false
   export let autoFocusText: () => string = () => ""
   export let onFocus: () => void = () => {}
   export let onSubmit: (value: string) => void = () => {}

   let input: HTMLInputElement
   let suggestionDiv: HTMLDivElement[] = []

   let shouldSubmit = true
   let suggestions: string[] = []
   let selectedSuggestion: number | null = null
   let inputMatchesSuggestion: boolean = false
   let suggestionBoxPosition = { x: 0, y: 0 }
   function updateSuggestionBoxPosition(positionAt: HTMLInputElement) {
      let rect = positionAt.getBoundingClientRect()
      suggestionBoxPosition = { x: rect.x - 5, y: rect.y + 19 }
   }
   function somethingWasScrolled() {
      if (document.activeElement === input) updateSuggestionBoxPosition(input)
   }
   function updateSuggestions(currentInput: string) {
      let inputLowerCase = currentInput.toLowerCase()
      suggestions = []
      selectedSuggestion = null
      inputMatchesSuggestion = false
      if (textCompletion) {
         for (let option of textCompletion) {
            if (option != "" && option.toLowerCase().includes(inputLowerCase)) {
               suggestions.push(option)
               if (option === currentInput) inputMatchesSuggestion = true
            }
         }
      }
   }
   function clearSuggestions() {
      suggestions = []
      selectedSuggestion = null
   }
   function clickSuggestion(i: number) {
      input.value = suggestions[i]
      input.blur()
   }
   function onKeydown(this: HTMLInputElement, event: KeyboardEvent) {
      if (event.key === "Enter" || event.key === "Tab") {
         this.blur()
      } else if (event.key === "Escape") {
         shouldSubmit = false
         this.blur()
      } else if (event.key === "ArrowUp" && suggestions.length > 0) {
         event.preventDefault()
         if (selectedSuggestion === null) selectedSuggestion = 0
         else if (selectedSuggestion > 0) --selectedSuggestion
         this.value = suggestions[selectedSuggestion]
         let div: any = suggestionDiv[selectedSuggestion]
         if (div) div.scrollIntoViewIfNeeded(false) // Only works in Chrome.
         inputMatchesSuggestion = true
      } else if (event.key === "ArrowDown" && suggestions.length > 0) {
         event.preventDefault()
         if (selectedSuggestion === null) selectedSuggestion = 0
         else if (selectedSuggestion < suggestions.length - 1)
            ++selectedSuggestion
         this.value = suggestions[selectedSuggestion]
         let div: any = suggestionDiv[selectedSuggestion]
         if (div) div.scrollIntoViewIfNeeded(false) // Only works in Chrome.
         inputMatchesSuggestion = true
      }
   }
   function onInput(this: HTMLInputElement) {
      updateSuggestions(this.value)
   }
   function onFocus_(this: HTMLInputElement) {
      this.value = text
      shouldSubmit = true
      updateSuggestions(this.value)
      updateSuggestionBoxPosition(this)
      onFocus()
   }
   function onBlur(this: HTMLInputElement) {
      if (shouldSubmit) onSubmit(this.value)
      this.value = ""
      clearSuggestions()
   }
   // Svelte will call this function whenever it updates the HTML of the <input>
   // element.
   function svelteChange(node: HTMLInputElement, focus: boolean): any {
      if (focus) {
         node.focus()
         node.value = autoFocusText()
         updateSuggestions(node.value)
         node.select()
      }
      return {
         // Svelte calls this returned "update" function whenever the element is
         // modified. When this happens, we just call "change" again.
         update: (focus_: boolean) => svelteChange(node, focus_),
      }
   }
   let textFieldColorStyle = ""
   $: {
      if (textCompletion) {
         if (inputMatchesSuggestion) {
            textFieldColorStyle = "inputMatchesSuggestion"
         } else {
            textFieldColorStyle = "inputUnknown"
         }
      }
   }
</script>

<div class="textField {textFieldColorStyle}" style="width: {width}px">
   <div class="submittedText">{text}</div>
   <input
      type="text"
      on:keydown={onKeydown}
      on:input={onInput}
      on:focus={onFocus_}
      on:blur={onBlur}
      use:svelteChange={autoFocus}
      bind:this={input}
   />
   {#if suggestions.length > 0}
      <div
         class="suggestionBox"
         style="min-width: {width +
            6}px; left: {suggestionBoxPosition.x}px; top: {suggestionBoxPosition.y}px;"
      >
         {#each suggestions as suggestion, i}
            <div
               bind:this={suggestionDiv[i]}
               class={i === selectedSuggestion
                  ? "selected suggestion"
                  : "suggestion"}
               on:mousemove={() => {
                  selectedSuggestion = i
               }}
               on:mousedown={(event) => {
                  clickSuggestion(i)
                  // Prevent inputs at the mouse location from becoming focused.
                  event.preventDefault()
               }}
            >
               {suggestion}
            </div>
         {/each}
      </div>
   {/if}
</div>

<svelte:window on:scroll|capture|passive={somethingWasScrolled} />

<style>
   .textField {
      position: relative; /*Sets an origin for the position:absolute elements.*/
      height: 1em;
      padding: 2px 3px;
      border: 1px solid #222;
      margin: 1px;
   }
   .textField:focus-within {
      color: transparent; /* inherited by the child text */
      border-width: 2px;
      margin: 0px;
   }
   .textField.inputUnknown:focus-within {
      background-color: #f3d402;
   }
   .textField.inputMatchesSuggestion:focus-within {
      background-color: #7ef382;
   }
   .textField:hover:not(:focus-within) {
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
   .suggestionBox {
      position: fixed;
      z-index: 1000;
      border: 1px solid white;
      padding: 1px 1px;
      background: #ddd;
      color: black;
      max-height: 160px;
      overflow: scroll;
      box-shadow: 0 0 8px 0 rgb(0, 0, 0, 0.3);
   }
   .suggestion {
      padding: 2px 2px;
   }
   .selected.suggestion {
      background-color: white;
   }
</style>
