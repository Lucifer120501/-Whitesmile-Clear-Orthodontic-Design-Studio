import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';

export default defineConfig({
    plugins: [
        laravel({
            input: [
                'resources/sass/sb-admin.scss',
                'resources/js/sb-admin.js',
            ],
            refresh: true,
            fonts: [
                'node_modules/@fontsource/inter/variable.css',
                'node_modules/@fontsource/inter/400.css',
                'node_modules/@fontsource/inter/500.css',
                'node_modules/@fontsource/inter/600.css',
                'node_modules/@fontsource/nunito/400.css',
                'node_modules/@fontsource/nunito/600.css',
            ],
        }),
    ],
});
