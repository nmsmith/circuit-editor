import sveltePreprocess from 'svelte-preprocess'

export default {
  // svelte-preprocess is necessary to compile Svelte components written in TypeScript.
  // It also allows us to use languages like Sass and Pug.
  preprocess: sveltePreprocess()
}
