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
} from "../db/operations";
import type { ShoppingList } from "../types";
import { ChevronRight, DragIcon, PlusIcon, TrashIcon } from "./Icons";
import { Swipeable } from "./Swipeable";
import { SyncChip } from "./SyncChip";
import { AdminButton } from "./AdminButton";
import { listPath, navigate } from "../router";

export function ListsScreen() {
  const [newName, setNewName] = useState("");

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
    </div>
  );
}

function SortableListRow({
  list,
  onOpen,
}: {
  list: ShoppingList;
  onOpen: () => void;
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

  async function commitRename() {
    setEditing(false);
    if (name.trim() && name.trim() !== list.name) {
      await renameList(list.id, name);
    } else {
      setName(list.name);
    }
  }

  async function handleTrashClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${list.name}"?`)) return;
    await deleteList(list.id);
  }

  return (
    <li ref={setNodeRef} style={style}>
      <Swipeable onDelete={() => deleteList(list.id)}>
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
              <span className="row__title">{list.name}</span>
              <span className="row__meta">
                {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
            </button>
          )}

          <button
            type="button"
            className="row__icon"
            onClick={handleTrashClick}
            aria-label={`Delete ${list.name}`}
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
