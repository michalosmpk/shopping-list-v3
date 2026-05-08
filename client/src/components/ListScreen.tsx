import { useEffect, useState, type FormEvent } from "react";
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
  clearChecked,
  createItem,
  deleteItem,
  renameItem,
  reorderItems,
  toggleItem,
} from "../db/operations";
import type { ShoppingItem } from "../types";
import {
  CheckIcon,
  ChevronLeft,
  DragIcon,
  PlusIcon,
  TrashIcon,
} from "./Icons";
import { Swipeable } from "./Swipeable";
import { navigate } from "../router";
import { useSync } from "../sync/SyncProvider";

export function ListScreen({ listId }: { listId: string }) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");

  const list = useLiveQuery(() => db.lists.get(listId), [listId], undefined);
  const { status } = useSync();

  // If the list doesn't exist locally, give the sync engine a moment to
  // pull it down (e.g. user opened a saved tab on a fresh device); then
  // redirect to the overview if it's still missing.
  useEffect(() => {
    if (list === undefined) return; // still loading from Dexie
    if (list && !list.deleted) return; // got it
    const handle = window.setTimeout(() => {
      // Recheck through a fresh promise to avoid racing the live query.
      void db.lists.get(listId).then((fresh) => {
        if (!fresh || fresh.deleted) navigate("/", { replace: true });
      });
    }, status === "syncing" ? 1500 : 400);
    return () => window.clearTimeout(handle);
  }, [list, listId, status]);

  const onBack = () => navigate("/");

  const items = useLiveQuery(
    () =>
      db.items
        .where({ listId })
        .filter((i) => !i.deleted)
        .toArray()
        .then((arr) => arr.sort((a, b) => a.position - b.position)),
    [listId],
    []
  );

  const checkedCount = (items ?? []).filter((i) => i.checked).length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  if (!list || list.deleted) {
    return (
      <div className="screen">
        <header className="header">
          <button
            type="button"
            className="iconbtn"
            onClick={onBack}
            aria-label="Back"
          >
            <ChevronLeft />
          </button>
          <h1 className="header__title">Loading…</h1>
        </header>
        <div className="empty">
          <p>This list isn't available yet.</p>
          <p className="empty__hint">
            Trying to sync it from the server…
          </p>
        </div>
      </div>
    );
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    setQty("");
    await createItem(listId, trimmed, qty);
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = (items ?? []).map((i) => i.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(ids, oldIndex, newIndex);
    await reorderItems(listId, reordered);
  }

  return (
    <div className="screen">
      <header className="header">
        <button
          type="button"
          className="iconbtn"
          onClick={onBack}
          aria-label="Back"
        >
          <ChevronLeft />
        </button>
        <h1 className="header__title">{list.name}</h1>
        {checkedCount > 0 ? (
          <button
            type="button"
            className="iconbtn iconbtn--text"
            onClick={() => clearChecked(listId)}
          >
            Clear ✓ ({checkedCount})
          </button>
        ) : (
          <span className="iconbtn iconbtn--placeholder" aria-hidden />
        )}
      </header>

      <form className="addbar" onSubmit={handleAdd}>
        <input
          type="text"
          inputMode="text"
          placeholder="Add item…"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="text"
          inputMode="text"
          className="addbar__qty"
          placeholder="Qty"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <button type="submit" disabled={!name.trim()} aria-label="Add item">
          <PlusIcon />
        </button>
      </form>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={(items ?? []).map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="rows">
            {(items ?? []).map((item) => (
              <SortableItemRow key={item.id} item={item} />
            ))}
            {(items ?? []).length === 0 && (
              <li className="empty">
                <p>This list is empty.</p>
                <p className="empty__hint">Add your first item above.</p>
              </li>
            )}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableItemRow({ item }: { item: ShoppingItem }) {
  const sortable = useSortable({ id: item.id });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [qty, setQty] = useState(item.quantity);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: item.dirty > 0 ? 0.55 : isDragging ? 0.85 : 1,
  };

  async function commitEdit() {
    setEditing(false);
    const patch: { name?: string; quantity?: string } = {};
    const n = name.trim();
    if (n && n !== item.name) patch.name = n;
    if (qty !== item.quantity) patch.quantity = qty;
    if (Object.keys(patch).length > 0) {
      await renameItem(item.id, patch);
    } else {
      setName(item.name);
      setQty(item.quantity);
    }
  }

  return (
    <li ref={setNodeRef} style={style}>
      <Swipeable onDelete={() => deleteItem(item.id)}>
        <div className="row row--item">
          <button
            type="button"
            className="row__handle"
            aria-label="Reorder"
            {...attributes}
            {...listeners}
          >
            <DragIcon />
          </button>

          <button
            type="button"
            className={`checkbox${item.checked ? " checkbox--on" : ""}`}
            onClick={() => toggleItem(item.id)}
            aria-pressed={item.checked}
            aria-label={item.checked ? "Mark as not done" : "Mark as done"}
            data-no-swipe
          >
            {item.checked && <CheckIcon size={16} />}
          </button>

          {editing ? (
            <div className="row__edit" data-no-swipe>
              <input
                autoFocus
                className="row__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") {
                    setName(item.name);
                    setQty(item.quantity);
                    setEditing(false);
                  }
                }}
              />
              <input
                className="row__input row__input--qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                onBlur={commitEdit}
                placeholder="Qty"
                inputMode="numeric"
              />
            </div>
          ) : (
            <button
              type="button"
              className={`row__main${
                item.checked ? " row__main--checked" : ""
              }`}
              onClick={() => setEditing(true)}
            >
              <span className="row__title">{item.name || "(no name)"}</span>
              {item.quantity && (
                <span className="row__meta">{item.quantity}</span>
              )}
            </button>
          )}

          <button
            type="button"
            className="row__icon"
            onClick={() => deleteItem(item.id)}
            aria-label={`Delete ${item.name}`}
            data-no-swipe
          >
            <TrashIcon />
          </button>
        </div>
      </Swipeable>
    </li>
  );
}
