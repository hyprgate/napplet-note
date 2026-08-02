import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from '@unocss/vite';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [UnoCSS(), svelte(), nip5aManifest({
    nappletType: 'note-viewer',
    requires: ['identity', 'relay', 'inc', 'storage', 'resource', 'theme'],
    artifactMode: 'single-file',
    archetypes: [{ slug: 'note', convention: 'napplet:note/open' }],
  })],
  resolve: {
    dedupe: ['svelte'],
  },
  server: {
    port: 5184,
    cors: true,
  },
  build: {
    outDir: 'dist',
  },
});
