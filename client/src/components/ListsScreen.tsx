import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { db } from "../db/local";
import {
  createList,
  deleteList,
  reorderLists,
  renameList,
  restoreList,
} from "../db/operations";
import type { ShoppingList } from "../types";
import { ChevronRight, DragIcon, PlusIcon, TrashIcon } from "./Icons";
import { Swipeable } from "./Swipeable";
import { SyncChip } from "./SyncChip";
import { AdminButton } from "./AdminButton";
import { ConfirmModal } from "./ConfirmModal";
import { useToast } from "./Toast";
import { listPath, navigate } from "../router";

export function ListsScreen() {
  const [newName, setNewName] = useState("");
  // List pending a delete confirmation. Lifted up here (rather than per
  // row) so the trash icon AND the swipe-left gesture share one modal,
  // and so the modal renders at the screen level — outside the row's
  // transform/clip so the backdrop covers the whole viewport.
  const [pendingDelete, setPendingDelete] = useState<ShoppingList | null>(
    null
  );
  const { toast } = useToast();

  const lists = useLiveQuery(
    () =>
      db.lists
        .filter((l) => !l.deleted)
        .toArray()
        .then((arr) => arr.sort((a, b) => a.position - b.position)),
    [],
    []
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setNewName("");
    await createList(name);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = (lists ?? []).map((l) => l.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(ids, oldIndex, newIndex);
    await reorderLists(reordered);
  }

  // Whole-list deletes are heavyweight (they cascade to every item and
  // can be hard to spot in the undo toast among many concurrent
  // notifications) so we gate them behind a confirm prompt. Items keep
  // the lighter undo-toast-only flow — see ListScreen.
  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id, name } = pendingDelete;
    const verb = pendingDelete.isOwner !== false ? "Deleted" : "Left";
    setPendingDelete(null);
    await deleteList(id);
    toast({
      text: `${verb} "${name}"`,
      actionLabel: "Undo",
      duration: 10000,
      onAction: () => restoreList(id),
    });
  }

  return (
    <div className="screen">
      <header className="header">
        <h1>Lists</h1>
        <AdminButton />
        <SyncChip />
      </header>

      <form className="addbar" onSubmit={handleAdd}>
        <input
          type="text"
          inputMode="text"
          placeholder="New list name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" disabled={!newName.trim()} aria-label="Add list">
          <PlusIcon />
        </button>
      </form>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext
          items={(lists ?? []).map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="rows">
            {(lists ?? []).map((list) => (
              <SortableListRow
                key={list.id}
                list={list}
                onOpen={() => navigate(listPath(list.id))}
                onRequestDelete={() => setPendingDelete(list)}
              />
            ))}
            {(lists ?? []).length === 0 && (
              <li className="empty">
                <p>No lists yet.</p>
                <p className="empty__hint">Add one above to get started.</p>
              </li>
            )}
          </ul>
        </SortableContext>
      </DndContext>

      {pendingDelete && (
        <ConfirmModal
          title={
            pendingDelete.isOwner !== false
              ? `Delete "${pendingDelete.name}"?`
              : `Leave "${pendingDelete.name}"?`
          }
          body={
            pendingDelete.isOwner !== false
              ? "The list and all its items will be removed for everyone it's shared with. You'll have a few seconds to undo from the toast."
              : "You'll stop seeing this list. The owner can re-add you any time."
          }
          confirmLabel={pendingDelete.isOwner !== false ? "Delete" : "Leave"}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function SortableListRow({
  list,
  onOpen,
  onRequestDelete,
}: {
  list: ShoppingList;
  onOpen: () => void;
  onRequestDelete: () => void;
}) {
  const sortable = useSortable({ id: list.id });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(list.name);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: list.localOnly ? 0.55 : isDragging ? 0.85 : 1,
  };

  const itemCount = useLiveQuery(
    () =>
      db.items
        .where({ listId: list.id })
        .filter((i) => !i.deleted)
        .count(),
    [list.id],
    0
  );

  // Lists without server-confirmed ownership (just-created, never
  // synced) behave as owned. After the first sync round-trip the
  // server is authoritative.
  const isOwner = list.isOwner !== false;

  async function commitRename() {
    setEditing(false);
    if (name.trim() && name.trim() !== list.name) {
      await renameList(list.id, name);
    } else {
      setName(list.name);
    }
  }

  return (
    <li ref={setNodeRef} style={style}>
      <Swipeable onDelete={onRequestDelete}>
        <div className="row">
          <button
            type="button"
            className="row__handle"
            aria-label="Reorder"
            {...attributes}
            {...listeners}
          >
            <DragIcon />
          </button>

          {editing ? (
            <input
              className="row__input"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  setName(list.name);
                  setEditing(false);
                }
              }}
              data-no-swipe
            />
          ) : (
            <button
              type="button"
              className="row__main"
              onClick={onOpen}
              onDoubleClick={() => setEditing(true)}
            >
              <span className="row__title">
                {list.name}
                {list.shared && (
                  <span className="badge badge--shared"> shared</span>
                )}
              </span>
              <span className="row__meta">
                {itemCount} {itemCount === 1 ? "item" : "items"}
                {!isOwner && list.ownerName
                  ? ` · by ${list.ownerName}`
                  : isOwner && list.shared
                    ? " · shared by you"
                    : ""}
              </span>
            </button>
          )}

          <button
            type="button"
            className="row__icon"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
            aria-label={isOwner ? `Delete ${list.name}` : `Leave ${list.name}`}
            data-no-swipe
          >
            <TrashIcon />
          </button>
          <button
            type="button"
            className="row__icon"
            onClick={onOpen}
            aria-label={`Open ${list.name}`}
            data-no-swipe
          >
            <ChevronRight />
          </button>
        </div>
      </Swipeable>
    </li>
  );
}
