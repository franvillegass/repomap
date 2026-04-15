'use client'

// ============================================================
// RepoMap — BranchPanel
//
// Sidebar panel for the branch system.
// Shows the branch tree, lets the user create/switch/rename/delete.
//
// Place in: src/components/branches/BranchPanel.tsx
// ============================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import { useBranches } from './UseBranches'
import type { Branch } from './types'

// ------------------------------------------------------------
// Palette & design tokens (inline, no Tailwind config needed)
// ------------------------------------------------------------
const BRANCH_COLORS = [
  '#60a5fa', // blue
  '#34d399', // emerald
  '#f472b6', // pink
  '#fb923c', // orange
  '#a78bfa', // violet
  '#facc15', // yellow
  '#22d3ee', // cyan
  '#f87171', // red
]

function pickColor(index: number) {
  return BRANCH_COLORS[index % BRANCH_COLORS.length]
}

// ------------------------------------------------------------
// Types
// ------------------------------------------------------------
interface CreateFormState {
  parentBranchId: string | null
  name: string
  description: string
  color: string
}

// ------------------------------------------------------------
// BranchPanel (root component)
// ------------------------------------------------------------
export function BranchPanel() {
  const {
    branches,
    activeBranchId,
    loading,
    error,
    isOnBranch,
    setActiveBranch,
    createNewBranch,
    removeBranch,
    updateBranch,
    childrenOf,
  } = useBranches()

  const [creating, setCreating] = useState<CreateFormState | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Open "create" form with a given parent
  const openCreate = useCallback((parentBranchId: string | null) => {
    const index = branches.length
    setCreating({
      parentBranchId,
      name: '',
      description: '',
      color: pickColor(index),
    })
    setEditingId(null)
  }, [branches.length])

  const handleCreate = useCallback(async () => {
    if (!creating || !creating.name.trim()) return
    const branch = await createNewBranch({
      name:           creating.name.trim(),
      description:    creating.description.trim() || undefined,
      color:          creating.color,
      parentBranchId: creating.parentBranchId,
    })
    setCreating(null)
    await setActiveBranch(branch.id)
  }, [creating, createNewBranch, setActiveBranch])

  // Root-level branches (children of base graph)
  const rootBranches = childrenOf(null)

  return (
    <aside style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerLabel}>BRANCHES</span>
        <button
          style={styles.newBranchBtn}
          onClick={() => openCreate(null)}
          title="New branch from base"
        >
          <PlusIcon />
          New
        </button>
      </div>

      {/* Base graph row */}
      <button
        style={{
          ...styles.baseRow,
          ...(activeBranchId === null ? styles.baseRowActive : {}),
        }}
        onClick={() => setActiveBranch(null)}
      >
        <span style={styles.baseIcon}>◈</span>
        <span style={styles.baseName}>Base graph</span>
        {activeBranchId === null && <span style={styles.activePill}>active</span>}
      </button>

      <div style={styles.divider} />

      {/* Branch tree */}
      <div style={styles.treeContainer}>
        {loading && <span style={styles.dimText}>Loading…</span>}
        {error   && <span style={styles.errorText}>{error}</span>}

        {!loading && branches.length === 0 && (
          <div style={styles.emptyState}>
            <span style={styles.emptyIcon}>⑂</span>
            <span style={styles.emptyText}>No branches yet.</span>
            <span style={styles.emptyHint}>
              Create one to start exploring &quot;what-if&quot; changes without touching the base graph.
            </span>
          </div>
        )}

        {rootBranches.map(branch => (
          <BranchTreeNode
            key={branch.id}
            branch={branch}
            depth={0}
            activeBranchId={activeBranchId}
            editingId={editingId}
            creating={creating}
            onActivate={setActiveBranch}
            onStartEdit={setEditingId}
            onFinishEdit={async (id, patch) => {
              await updateBranch(id, patch)
              setEditingId(null)
            }}
            onDelete={removeBranch}
            onCreateChild={openCreate}
            onSubmitCreate={handleCreate}
            onCancelCreate={() => setCreating(null)}
            onChangeCreate={setCreating}
            childrenOf={childrenOf}
          />
        ))}

        {/* Inline create form at root level */}
        {creating && creating.parentBranchId === null && (
          <CreateForm
            value={creating}
            depth={0}
            onChange={setCreating}
            onSubmit={handleCreate}
            onCancel={() => setCreating(null)}
          />
        )}
      </div>
    </aside>
  )
}

// ------------------------------------------------------------
// BranchTreeNode — recursive node in the branch tree
// ------------------------------------------------------------
interface BranchTreeNodeProps {
  branch: Branch
  depth: number
  activeBranchId: string | null
  editingId: string | null
  creating: CreateFormState | null
  onActivate: (id: string) => void
  onStartEdit: (id: string) => void
  onFinishEdit: (id: string, patch: Partial<Pick<Branch, 'name' | 'description' | 'color'>>) => void
  onDelete: (id: string) => void
  onCreateChild: (parentId: string) => void
  onSubmitCreate: () => void
  onCancelCreate: () => void
  onChangeCreate: (v: CreateFormState) => void
  childrenOf: (id: string | null) => Branch[]
}

function BranchTreeNode({
  branch,
  depth,
  activeBranchId,
  editingId,
  creating,
  onActivate,
  onStartEdit,
  onFinishEdit,
  onDelete,
  onCreateChild,
  onSubmitCreate,
  onCancelCreate,
  onChangeCreate,
  childrenOf,
}: BranchTreeNodeProps) {
  const isActive   = activeBranchId === branch.id
  const isEditing  = editingId === branch.id
  const children   = childrenOf(branch.id)
  const [editName, setEditName] = useState(branch.name)
  const [editDesc, setEditDesc] = useState(branch.description ?? '')
  const [hovered, setHovered]   = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing) nameRef.current?.focus()
  }, [isEditing])

  const indent = depth * 16

  return (
    <div style={{ marginLeft: indent }}>
      {/* Connector line */}
      {depth > 0 && <div style={styles.connector} />}

      {/* Branch row */}
      {isEditing ? (
        <div style={styles.editRow}>
          <span
            style={{ ...styles.colorDot, background: branch.color ?? '#60a5fa' }}
          />
          <input
            ref={nameRef}
            style={styles.editInput}
            value={editName}
            onChange={e => setEditName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onFinishEdit(branch.id, { name: editName, description: editDesc })
              if (e.key === 'Escape') onStartEdit('')
            }}
            placeholder="Branch name"
          />
          <input
            style={{ ...styles.editInput, fontSize: 11, opacity: 0.6 }}
            value={editDesc}
            onChange={e => setEditDesc(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') onFinishEdit(branch.id, { name: editName, description: editDesc })
              if (e.key === 'Escape') onStartEdit('')
            }}
            placeholder="Description (optional)"
          />
          <div style={styles.editActions}>
            <button
              style={styles.confirmBtn}
              onClick={() => onFinishEdit(branch.id, { name: editName, description: editDesc })}
            >✓</button>
            <button
              style={styles.cancelBtn}
              onClick={() => onStartEdit('')}
            >✕</button>
          </div>
        </div>
      ) : (
        <div
          style={{
            ...styles.branchRow,
            ...(isActive  ? styles.branchRowActive  : {}),
            ...(hovered && !isActive ? styles.branchRowHover : {}),
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Color dot + name */}
          <button
            style={styles.branchMain}
            onClick={() => onActivate(branch.id)}
          >
            <span style={{ ...styles.colorDot, background: branch.color ?? '#60a5fa' }} />
            <span style={styles.branchName}>{branch.name}</span>
            {isActive && <span style={styles.activePill}>active</span>}
          </button>

          {/* Actions (visible on hover or active) */}
          {(hovered || isActive) && (
            <div style={styles.rowActions}>
              <ActionButton
                title="Create child branch"
                onClick={() => onCreateChild(branch.id)}
              >⑂</ActionButton>
              <ActionButton
                title="Rename"
                onClick={() => onStartEdit(branch.id)}
              >✎</ActionButton>
              <ActionButton
                title="Delete branch"
                danger
                onClick={() => {
                  if (confirm(`Delete branch "${branch.name}" and all its children?`)) {
                    onDelete(branch.id)
                  }
                }}
              >✕</ActionButton>
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {!isEditing && branch.description && (
        <div style={{ ...styles.branchDesc, marginLeft: 16 + indent }}>
          {branch.description}
        </div>
      )}

      {/* Children */}
      {children.map(child => (
        <BranchTreeNode
          key={child.id}
          branch={child}
          depth={depth + 1}
          activeBranchId={activeBranchId}
          editingId={editingId}
          creating={creating}
          onActivate={onActivate}
          onStartEdit={onStartEdit}
          onFinishEdit={onFinishEdit}
          onDelete={onDelete}
          onCreateChild={onCreateChild}
          onSubmitCreate={onSubmitCreate}
          onCancelCreate={onCancelCreate}
          onChangeCreate={onChangeCreate}
          childrenOf={childrenOf}
        />
      ))}

      {/* Inline create form as child of this branch */}
      {creating && creating.parentBranchId === branch.id && (
        <CreateForm
          value={creating}
          depth={depth + 1}
          onChange={onChangeCreate}
          onSubmit={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------------
// CreateForm — inline form for naming a new branch
// ------------------------------------------------------------
interface CreateFormProps {
  value: CreateFormState
  depth: number
  onChange: (v: CreateFormState) => void
  onSubmit: () => void
  onCancel: () => void
}

function CreateForm({ value, depth, onChange, onSubmit, onCancel }: CreateFormProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div style={{ marginLeft: depth * 16, ...styles.createForm }}>
      {/* Color picker */}
      <div style={styles.colorRow}>
        {BRANCH_COLORS.map(c => (
          <button
            key={c}
            style={{
              ...styles.colorSwatch,
              background: c,
              outline: value.color === c ? `2px solid #fff` : 'none',
              outlineOffset: 2,
            }}
            onClick={() => onChange({ ...value, color: c })}
          />
        ))}
      </div>

      <input
        ref={inputRef}
        style={styles.createInput}
        placeholder="Branch name…"
        value={value.name}
        onChange={e => onChange({ ...value, name: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter')  onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <input
        style={{ ...styles.createInput, fontSize: 11, opacity: 0.65 }}
        placeholder="Description (optional)"
        value={value.description}
        onChange={e => onChange({ ...value, description: e.target.value })}
        onKeyDown={e => {
          if (e.key === 'Enter')  onSubmit()
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div style={styles.createActions}>
        <button
          style={styles.createSubmit}
          onClick={onSubmit}
          disabled={!value.name.trim()}
        >
          Create branch
        </button>
        <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------
// ActionButton — small icon button in branch rows
// ------------------------------------------------------------
function ActionButton({
  children,
  title,
  danger = false,
  onClick,
}: {
  children: React.ReactNode
  title: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      title={title}
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        ...styles.actionBtn,
        ...(danger ? styles.actionBtnDanger : {}),
      }}
    >
      {children}
    </button>
  )
}

// ------------------------------------------------------------
// PlusIcon
// ------------------------------------------------------------
function PlusIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginRight: 4 }}>
      <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ------------------------------------------------------------
// Styles (CSS-in-JS, no Tailwind dependency)
// ------------------------------------------------------------
const styles: Record<string, React.CSSProperties> = {
  panel: {
    width: 240,
    minWidth: 240,
    height: '100%',
    background: '#0f1117',
    borderRight: '1px solid #1e2130',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: "'IBM Plex Mono', 'Fira Mono', monospace",
    fontSize: 12,
    color: '#c9d1d9',
    overflowY: 'auto',
    userSelect: 'none',
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 12px 10px',
    borderBottom: '1px solid #1e2130',
  },

  headerLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.12em',
    color: '#4b5563',
  },

  newBranchBtn: {
    display: 'flex',
    alignItems: 'center',
    background: '#1a2035',
    border: '1px solid #2a3350',
    borderRadius: 4,
    color: '#93c5fd',
    fontSize: 11,
    padding: '3px 8px',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },

  baseRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '9px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: '#9ca3af',
    fontSize: 12,
    textAlign: 'left',
    transition: 'background 0.1s',
  },

  baseRowActive: {
    background: '#111827',
    color: '#f9fafb',
  },

  baseIcon: {
    fontSize: 14,
    color: '#374151',
  },

  baseName: {
    flex: 1,
    fontFamily: "'IBM Plex Mono', monospace",
  },

  activePill: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.08em',
    background: '#1e3a5f',
    color: '#60a5fa',
    borderRadius: 3,
    padding: '1px 5px',
    textTransform: 'uppercase',
  },

  divider: {
    height: 1,
    background: '#1e2130',
    margin: '0 0 4px',
  },

  treeContainer: {
    flex: 1,
    padding: '4px 0 16px',
    overflowY: 'auto',
  },

  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: '32px 20px',
    textAlign: 'center',
  },

  emptyIcon: {
    fontSize: 28,
    color: '#1f2937',
  },

  emptyText: {
    color: '#4b5563',
    fontWeight: 600,
    fontSize: 12,
  },

  emptyHint: {
    color: '#374151',
    fontSize: 11,
    lineHeight: 1.5,
  },

  connector: {
    position: 'absolute',
    left: -8,
    top: 0,
    bottom: 0,
    width: 1,
    background: '#1e2130',
  },

  branchRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px 6px 12px',
    borderRadius: 4,
    margin: '1px 6px',
    transition: 'background 0.1s',
    position: 'relative',
  },

  branchRowActive: {
    background: '#111827',
  },

  branchRowHover: {
    background: '#0d1117',
  },

  branchMain: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'inherit',
    padding: 0,
    fontSize: 12,
    fontFamily: 'inherit',
    textAlign: 'left',
    minWidth: 0,
  },

  colorDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },

  branchName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: '#e2e8f0',
  },

  branchDesc: {
    fontSize: 10,
    color: '#4b5563',
    padding: '0 12px 4px',
    lineHeight: 1.4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  rowActions: {
    display: 'flex',
    gap: 2,
    flexShrink: 0,
  },

  actionBtn: {
    background: 'none',
    border: 'none',
    color: '#4b5563',
    cursor: 'pointer',
    fontSize: 13,
    padding: '2px 4px',
    borderRadius: 3,
    lineHeight: 1,
    transition: 'color 0.1s',
  },

  actionBtnDanger: {
    color: '#6b2737',
  },

  editRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '6px 10px',
    background: '#0d1117',
    borderRadius: 4,
    margin: '1px 6px',
    border: '1px solid #1e3a5f',
  },

  editInput: {
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #1e3a5f',
    color: '#e2e8f0',
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    padding: '2px 0',
    outline: 'none',
    width: '100%',
  },

  editActions: {
    display: 'flex',
    gap: 6,
    justifyContent: 'flex-end',
    marginTop: 2,
  },

  confirmBtn: {
    background: '#1e3a5f',
    border: 'none',
    color: '#60a5fa',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: 12,
  },

  cancelBtn: {
    background: 'none',
    border: 'none',
    color: '#4b5563',
    cursor: 'pointer',
    fontSize: 12,
    padding: '2px 6px',
  },

  createForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    padding: '8px 10px',
    background: '#0d1117',
    borderRadius: 4,
    margin: '4px 6px',
    border: '1px solid #1e3a5f',
  },

  colorRow: {
    display: 'flex',
    gap: 5,
    marginBottom: 2,
  },

  colorSwatch: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    transition: 'transform 0.1s',
  },

  createInput: {
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #1e2130',
    color: '#e2e8f0',
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    padding: '3px 0',
    outline: 'none',
    width: '100%',
  },

  createActions: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    marginTop: 2,
  },

  createSubmit: {
    background: '#1e3a5f',
    border: '1px solid #2a4a7f',
    color: '#93c5fd',
    borderRadius: 4,
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: "'IBM Plex Mono', monospace",
  },

  dimText: {
    color: '#374151',
    padding: '12px 16px',
    display: 'block',
  },

  errorText: {
    color: '#f87171',
    padding: '12px 16px',
    display: 'block',
    fontSize: 11,
  },
}