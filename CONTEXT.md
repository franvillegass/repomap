# RepoMap — CONTEXT.md
*Última actualización: sesión inicial de diseño*

## ¿Qué es RepoMap?
Aplicación web (Next.js) que toma una URL de GitHub y genera un diagrama de arquitectura interactivo y editable usando AI. El diagrama distingue entre dependencias de ingeniería (runtime) y de arquitectura (diseño estructural).

---

## Decisiones tomadas

### Stack tecnológico
- **Frontend:** Next.js 14 (App Router)
- **Graph renderer:** React Flow
- **AI SDK:** Vercel AI SDK (`generateObject` para JSON estructurado confiable)
- **AI provider (dev/test):** Groq — modelo `gpt-4o` (GPT-OSS 120B, gratuito)
- **AI provider (producción):** Anthropic — `claude-sonnet-4-20250514`
- **Swap de provider:** via variables de entorno, sin cambios de código
  - `AI_PROVIDER=groq|anthropic`
  - `AI_MODEL=gpt-4o|claude-sonnet-4-20250514`
- **Repo ingestion:** Octokit (GitHub REST API, sin clonar)
- **Persistencia:** IndexedDB (`idb` wrapper), sin backend para funcionalidad core
- **Styling:** Tailwind CSS
- **Cloud sync (futuro):** Supabase, opcional

### JSON Graph Schema v1.0
Archivo: `src/lib/pipeline/schemas/graph.ts`

Estructura principal:
```
RepoGraph = { meta, nodes[], edges[], overlay }
```

**Node IDs con prefijos de tipo** (decisión confirmada):
- `layer__name`
- `module__name`  
- `file__path`
- `component__name`

**Edge `confidence`** resuelve el problema de ambigüedad del Concept Report:
- `high` | `medium` | `uncertain`
- Edges `uncertain` se renderizan diferente, el usuario puede reclasificar

**`depth` explícito** en cada nodo (0-3) para simplificar el renderer sin recorrer árbol.

**`overlay` como capa separada** — los edits del usuario nunca tocan nodes/edges base. Permite re-análisis sin perder edits manuales.

### Pipeline de análisis — 3 passes determinísticos
Decisión: pipeline determinístico (Opción B), no tool use autónomo. Más predecible y debuggeable para Phase 1.

**Pass 1 — Structure** (`src/lib/pipeline/prompts/pass1.ts`)
- Input: file tree (solo paths)
- Output: `Pass1Output` — archivos relevantes, módulos tentatives, tamaño estimado
- `ignoredReasons` solo para debugging, no visible al usuario

**Pass 2 — Dependencies** (`src/lib/pipeline/prompts/pass2.ts`)
- Input: contenido de archivos (procesado por fileSampler) + módulos de Pass 1
- Output: `Pass2Output` — nodes (sin roles) + edges con tipo y confidence
- El modelo puede refinar agrupación de módulos de Pass 1

**Pass 3 — Semantics** (`src/lib/pipeline/prompts/pass3.ts`)
- Input: grafo de Pass 2 (solo JSON, sin código fuente)
- Output: `Pass3Output` — roles por nodo, patrones, detectedPattern, layoutTemplate
- Trabaja solo con topología del grafo (barato en tokens)

### File Sampler (`src/lib/pipeline/sampler/fileSampler.ts`)
Controla el token budget de Pass 2 según `estimatedSize`:
- `small`: hasta 300 líneas, sin skeleton
- `medium`: hasta 150 líneas, modo skeleton
- `large`: hasta 80 líneas, modo skeleton
- Skeleton = solo imports/exports + firmas de funciones + 3 líneas de cuerpo

### Orquestador (`src/lib/pipeline/pipeline.ts`)
- `runAnalysisPipeline(input)` ejecuta los 3 passes en secuencia
- `fetchFileContent` se inyecta como dependencia (fácil de mockear en tests)
- Cliente AI pendiente de configurar (ver TODO en el archivo)

---

## Estado actual
- [x] Concept Report analizado y decisiones extraídas
- [x] JSON Graph Schema v1.0 definido
- [x] Prompts de los 3 passes diseñados y en código
- [x] File sampler implementado
- [x] Orquestador del pipeline implementado (sin cliente AI aún)
- [ ] Configurar cliente AI (Vercel AI SDK + Groq)
- [ ] GitHub API integration (Octokit)
- [ ] Validación con Zod del output de cada pass
- [ ] API Route de Next.js que expone el pipeline
- [ ] React Flow renderer básico
- [ ] IndexedDB persistence

---

## Próximos pasos sugeridos
1. **Instalar dependencias y configurar cliente AI** — `@ai-sdk/groq`, `ai`, Zod
2. **Agregar validación Zod** a los outputs de cada pass (crítico para debugging)
3. **GitHub API integration** con Octokit — fetch file tree + file content
4. **API Route** en Next.js que une todo
5. **Test end-to-end** del pipeline con un repo pequeño real

---

## Preguntas de diseño abiertas (del Concept Report)
- Monorepos: flujo de UI no definido aún
- Costo por análisis: medir token usage en Phase 1
- Re-análisis: manual por ahora (botón), no automático
- Tokens privados: no persistir entre sesiones (por seguridad)

---

## Comportamiento de handoff
A medida que avance la conversación, estimar cuándo el historial se vuelve largo (~15-20 intercambios). Cuando llegue ese punto:
1. Avisar al usuario
2. Generar reporte de handoff con decisiones tomadas, estado actual, problemas resueltos, próximos pasos y contexto crítico
3. Generar versión actualizada de este CONTEXT.md incorporando todo lo nuevo
4. Incluir al final del reporte este mismo comportamiento, para que el próximo chat sepa que debe hacer lo mismo
