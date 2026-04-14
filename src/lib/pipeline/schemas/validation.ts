import { z } from 'zod'

// ------------------------------------------------------------
// Zod schemas — validate AI output before using it
// These mirror the TypeScript types in graph.ts exactly.
// If the model returns garbage, we get a clear error here.
// ------------------------------------------------------------

// --- Shared primitives ---

const NodeTypeSchema = z.enum(['layer', 'module', 'file', 'component'])
const EdgeTypeSchema = z.enum(['engineering', 'architecture', 'both'])
const EdgeConfidenceSchema = z.enum(['high', 'medium', 'uncertain'])
const EstimatedSizeSchema = z.enum(['small', 'medium', 'large'])

const DetectedPatternSchema = z.enum([
  'clean_architecture',
  'hexagonal',
  'mvc',
  'microservices',
  'layered_monolith',
  'feature_modules',
  'pipeline_etl',
  'unknown',
])

const LayoutTemplateSchema = z.enum([
  'concentric_rings',
  'horizontal_three_column',
  'cluster',
  'vertical_layers',
  'grid_clusters',
  'left_right_flow',
  'force_directed',
])

// --- Pass 1 ---

export const Pass1OutputSchema = z.object({
  relevantFiles: z.array(z.string()),
  ignoredReasons: z.record(z.string(), z.string()),
  tentativeModules: z.array(z.object({
    id: z.string().regex(/^module__/, 'Module id must start with "module__"'),
    label: z.string(),
    filePaths: z.array(z.string()),
    description: z.string(),
  })),
  detectedLanguages: z.array(z.string()),
  estimatedSize: EstimatedSizeSchema,
})

export type Pass1Output = z.infer<typeof Pass1OutputSchema>

// --- Pass 2 ---

export const Pass2OutputSchema = z.object({
  nodes: z.array(NodeWithoutRoleSchema),
  edges: z.array(EdgeSchema),
})

export type Pass2Output = z.infer<typeof Pass2OutputSchema>

// Schemas separados para las dos llamadas del Pass 2
export const Pass2NodesSchema = z.object({
  nodes: z.array(NodeWithoutRoleSchema),
})

export const Pass2EdgesSchema = z.object({
  edges: z.array(EdgeSchema),
})

export type Pass2Nodes = z.infer<typeof Pass2NodesSchema>
export type Pass2Edges = z.infer<typeof Pass2EdgesSchema>

// --- Pass 3 ---

export const Pass3OutputSchema = z.object({
  meta: z.object({
    detectedPattern: DetectedPatternSchema,
    layoutTemplate: LayoutTemplateSchema,
    patternConfidence: z.number().min(0).max(1),
  }),
  nodeEnrichments: z.record(z.string(), z.object({
    detectedRole: z.string(),
    patterns: z.array(z.string()),
  })),
})

export type Pass3Output = z.infer<typeof Pass3OutputSchema>
