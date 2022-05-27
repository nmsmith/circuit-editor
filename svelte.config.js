import sveltePreprocess from "svelte-preprocess"

export default {
   // svelte-preprocess is necessary to compile Svelte components written in TypeScript.
   preprocess: sveltePreprocess(),
}
