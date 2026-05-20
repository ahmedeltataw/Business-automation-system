# Tech Stack & Performance Standards — Content Creator Context

## Core Build Stack (Mandatory)

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| **Build Tool** | Vite | 6.x | ESM-native, sub-second HMR |
| **Meta-Framework** | Astro.js | 5.x | Partial hydration, zero-JS by default |
| **UI Library** | React | 19.x | Server components when possible |
| **Lightweight Alt** | Preact | 10.x | For high-performance landing pages |
| **CSS Architecture** | CUBE CSS + BEM | — | Composition-first, utility classes only for layout |
| **Preprocessor** | SCSS | latest | Nesting, mixins, custom properties |
| **Templating** | Pug.js | 3.x | For static/email templates |
| **Accessibility** | A11y semantic HTML | WCAG 2.2 AA | Mandatory for all production code |

## Performance Standards (Non-Negotiable)

### Lighthouse Targets
| Metric | Minimum | Target |
|--------|---------|--------|
| **Performance Score** | 90 | 95+ |
| **First Contentful Paint (FCP)** | <1.8s | <1.0s |
| **Largest Contentful Paint (LCP)** | <2.5s | <1.5s |
| **Total Blocking Time (TBT)** | <200ms | <100ms |
| **Cumulative Layout Shift (CLS)** | <0.1 | <0.05 |
| **Speed Index** | <3.0s | <1.8s |
| **Accessibility Score** | 95 | 100 |
| **SEO Score** | 90 | 100 |
| **Best Practices** | 90 | 100 |

### Bundle Budgets
| Asset Type | Budget | Priority |
|-----------|--------|----------|
| JS (initial load) | <100KB gzip | CRITICAL |
| CSS (initial load) | <30KB gzip | CRITICAL |
| Fonts | <50KB total | HIGH |
| Images (hero) | <200KB WebP | HIGH |
| Third-party scripts | 0 (unless critical) | CRITICAL |

## CSS Methodology

### CUBE CSS (Composition Utility Block Exception)
```
Composition: Layout only — grid, flexbox, spacing. Never visual styles.
Utility: Single-purpose classes — .text-center, .flow, .wrapper
Block: Component-level styles — .card, .button, .header
Exception: One-off overrides — explicitly named, never !important
```

### BEM Naming (Within Blocks)
```
.block__element--modifier
.card__title--large
.button--primary
```

### SCSS Structure
```
styles/
├── settings/      # Variables, maps, design tokens
├── tools/         # Mixins, functions
├── generic/       # Reset, normalize, box-sizing
├── elements/      # Base HTML elements (h1, a, p)
├── compositions/  # Layout patterns (grid, cluster, sidebar)
├── utilities/     # Utility classes
├── blocks/        # Component styles (BEM)
└── exceptions/    # Overrides (rare)
```

## HTML Structure Requirements

### Mandatory Elements Per Page
```html
<!DOCTYPE html>
<html lang="ar" dir="rtl"> <!-- or ltr for English -->
<head>
  <!-- Primary meta tags -->
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="..." />
  
  <!-- Open Graph -->
  <meta property="og:title" content="..." />
  <meta property="og:description" content="..." />
  <meta property="og:image" content="..." />
  <meta property="og:type" content="website" />
  
  <!-- Performance -->
  <link rel="preload" href="/fonts/..." as="font" crossorigin />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  
  <!-- Canonical -->
  <link rel="canonical" href="https://..." />
</head>
<body>
  <!-- Skip to content (A11y) -->
  <a href="#main-content" class="skip-link">Skip to content</a>
  
  <!-- Landmarks -->
  <header role="banner">...</header>
  <nav role="navigation" aria-label="Main">...</nav>
  <main id="main-content" role="main">...</main>
  <footer role="contentinfo">...</footer>
</body>
```

### A11y Checklist
- [ ] All images have descriptive `alt` text
- [ ] Color contrast meets WCAG AA (4.5:1 normal text, 3:1 large text)
- [ ] Focus indicators visible on all interactive elements
- [ ] ARIA labels on non-semantic interactive elements
- [ ] Form inputs have associated `<label>` elements
- [ ] Heading hierarchy is logical (h1 → h2 → h3, never skip)
- [ ] Touch targets minimum 44x44px on mobile
- [ ] `prefers-reduced-motion` respected

## JavaScript Loading Strategy

### Priority Order
1. **Critical CSS** — inlined in `<head>`, <4KB
2. **Fonts** — preloaded, `font-display: swap`
3. **Hero images** — `loading="eager"`, above-fold images
4. **Deferred JS** — `type="module"`, `async` for non-critical
5. **Lazy images** — `loading="lazy"`, below-fold
6. **Analytics** — `partytown` or worker-thread

### Never Ship
- jQuery (unless legacy project)
- Bootstrap CSS (use CUBE CSS instead)
- Font Awesome (use inline SVG icons)
- Unused polyfills (check browser targets)
- Unminified assets in production

## Build Configuration

### Vite
```js
// vite.config.ts
export default defineConfig({
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  // Always generate CSP-compatible output
});
```

### Astro.js
```
// astro.config.mjs
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static', // or 'server' for SSR
  compressHTML: true,
  scopedStyleStrategy: 'attribute',
  integrations: [react(), sitemap()],
});
```

## QA Gates (Pre-Deployment)

1. `npx lighthouse-ci https://staging.example.com --score=90`
2. `npx axe-core https://staging.example.com` (zero A11y violations)
3. `npx check-peer-deps` (no version conflicts)
4. `npx bundle-wize dist/` (budget compliance)
5. Validate HTML with `validator.nu` (zero errors)
6. Responsive check: 320px, 768px, 1024px, 1440px, 1920px
7. Print stylesheet exists and renders cleanly
