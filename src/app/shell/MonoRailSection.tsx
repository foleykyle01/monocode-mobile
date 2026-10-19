import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ImagePlus, MoreHorizontal, Plus, Trash2 } from "../../shared/ui/icons";
import { Popover, type PopoverAnchor } from "../../shared/ui/Popover";
import { Shimmer } from "../../shared/ui/Shimmer";
import { useAnimatedReorder } from "../../shared/hooks/useAnimatedReorder";
import { MonoStatusDot } from "../../features/monos/ui/MonoRailMascot";
import { PixelMascot } from "../../features/projects/ui/PixelMascot";
import { ProjectMascot } from "../../features/projects/ui/ProjectMascot";
import { MonoIntroPopover } from "../../features/monos/ui/MonoIntro";
import { ProjectBackgroundDialog } from "../../features/projects/ui/ProjectBackgroundDialog";
import { monoBackgroundKey } from "../../features/monos/model/monoBackground";
import {
  ColorPicker,
  MascotPicker,
} from "../../features/monos/ui/monoPanelParts";
import {
  defaultMonoName,
  dismissMonoIntro,
  findMono,
  listMonos,
  MONO_STATUS_LABEL,
  monoIntroDismissed,
  nextMonoLook,
  monoLook,
  monoProjectsPhrase,
  monosSnapshot,
  monoWorksOn,
  reorderMonos,
  saveMonoMascot,
  saveMonoName,
  subscribeMonos,
  updateMono,
  type MonoState,
} from "../../features/monos/model/mono";
import type { MonoProjectScope } from "../../features/monos/model/monoActivityState";
import {
  pathKey,
  prettyCwd,
  projectKey,
  projectName,
} from "../../shared/lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupMascot,
} from "../../features/workspace/model/tabGroups";

export type MonoRailProps = {
  /** The Mono open in the main area, if any. */
  activeId?: string;
  /** What each Mono is doing, by Mono id; missing reads as idle. */
  states: ReadonlyMap<string, MonoState>;
  /** Replies each Mono has that the user has not looked at yet, by Mono id. */
  unseenCounts?: ReadonlyMap<string, number>;
  /** Active linked projects, or each Mono's retained idle scope. */
  projectScopes?: ReadonlyMap<string, readonly MonoProjectScope[]>;
  onOpen: (monoId: string) => void;
  /** Creates a Mono, given these projects to start with. */
  onCreate: (projects?: readonly string[]) => void;
  onDelete: (monoId: string) => void;
  /** Whether the intro may show now, when there is no Mono yet. */
  introAvailable?: boolean;
  /** The compact project surface or the readable dedicated Mono directory. */
  presentation?: Presentation;
};

type Presentation = "compact" | "directory";

const IDLE: MonoState = { status: "idle" };

/** A Mono's unread count as its badge shows it. */
export function unreadBadge(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function unreadLabel(count: number): string {
  return count === 1 ? "1 new reply" : `${count} new replies`;
}

/**
 * The user's Monos, above the projects. Each opens like a project does, but
 * into its conversation; none belongs to a project, so they get a section of
 * their own and the shaded mascot rather than a project's flat one.
 */
export function MonoRailSection({
  activeId,
  states,
  unseenCounts,
  projectScopes,
  onOpen,
  onCreate,
  onDelete,
  introAvailable = false,
  presentation = "compact",
  project,
}: MonoRailProps & {
  /** Inset sidebars list only Monos that work in their project. */
  project?: string;
}) {
  const snapshot = useSyncExternalStore(subscribeMonos, monosSnapshot);
  const monos = useMemo(
    () => listMonos().filter((mono) => !project || monoWorksOn(mono, project)),
    [snapshot, project],
  );
  const [addButton, setAddButton] = useState<HTMLButtonElement | null>(null);
  // Shown once ever, and only the user's choice puts it away.
  const showIntro =
    !project && introAvailable && monos.length === 0 && !monoIntroDismissed();
  const ids = monos.map((mono) => mono.id);
  const sortable = useAnimatedReorder(ids, reorderMonos, "y");
  const [menu, setMenu] = useState<{ id: string; anchor: PopoverAnchor }>();
  const [background, setBackground] = useState<string>();
  const backgroundMono = background ? findMono(background) : undefined;
  const directory = presentation === "directory";

  return (
    <div
      className={`mb-2 shrink-0 ${directory ? "px-1" : project ? "px-2 pb-3" : ""}`}
      data-mono-rail
      data-mono-presentation={presentation}
      data-mono-project={project}
    >
      <div
        className={
          project
            ? "flex h-7 items-center gap-1 px-2 text-[12px] font-medium text-content/50"
            : "flex items-center gap-1 px-3 pb-1.5 pt-1"
        }
      >
        <span className="min-w-0 flex-1 truncate px-1 text-xs leading-5 text-content/50">
          Monos
        </span>
        {/* With none yet, the row below is the way to add one. */}
        {monos.length ? (
          <button
            type="button"
            title={directory ? "Create a Mono" : "New mono"}
            aria-label={directory ? "Create a Mono" : "New mono"}
            onClick={() => onCreate(project ? [project] : undefined)}
            className={`grid shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/8 hover:text-content ${
              directory ? "size-7" : "size-5"
            }`}
          >
            <Plus
              className={directory ? "size-4" : "size-3.5"}
              strokeWidth={1.75}
            />
          </button>
        ) : null}
      </div>
      {showIntro && addButton ? (
        <MonoIntroPopover
          anchor={addButton}
          look={nextMonoLook(monos)}
          onCreate={() => {
            dismissMonoIntro();
            onCreate(project ? [project] : undefined);
          }}
          onLater={dismissMonoIntro}
        />
      ) : null}
      <div className="flex flex-col gap-px px-2">
        {monos.length === 0 ? (
          <button
            ref={setAddButton}
            type="button"
            data-mono-add
            title={directory ? "Create a Mono" : "New mono"}
            aria-label={directory ? "Create a Mono" : "New mono"}
            onClick={() => onCreate(project ? [project] : undefined)}
            className={`w-full cursor-default rounded-md border border-dashed border-content/15 text-content/50 hover:border-content/30 hover:bg-content/5 hover:text-content ${
              directory
                ? "flex min-h-14 items-center justify-center gap-2 text-[15px] font-medium"
                : "grid h-8 place-items-center"
            }`}
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            {directory ? <span>Create a Mono</span> : null}
          </button>
        ) : null}
        {monos.map((mono) => {
          const look = monoLook(mono);
          const state = states.get(mono.id) ?? IDLE;
          const selected = mono.id === activeId;
          const unseen = selected ? 0 : (unseenCounts?.get(mono.id) ?? 0);
          const projects = look.projects.length
            ? monoProjectsPhrase(look.projects)
            : "No projects yet";
          const status =
            state.status === "idle"
              ? unseen
                ? "Done, unread"
                : undefined
              : MONO_STATUS_LABEL[state.status];
          const scopes = (projectScopes?.get(mono.id) ?? []).filter((scope) =>
            look.projects.some(
              (project) => pathKey(project.path) === pathKey(scope.path),
            ),
          );
          return (
            <div
              key={mono.id}
              ref={(el) => sortable.setItemRef(mono.id, el)}
              data-selected={selected || undefined}
              data-mono-status={state.status}
              className={`reorder-item project-reorder-item group relative flex flex-col cursor-default touch-none items-stretch rounded-md px-2 ${
                directory
                  ? "min-h-14 rounded-lg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/70 has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-background-base"
                  : "h-8"
              } ${
                selected
                  ? directory
                    ? "bg-selection-strong text-content ring-1 ring-accent/35"
                    : "bg-selection-strong text-content"
                  : directory
                    ? "hover:bg-content/8"
                    : ""
              }`}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                if (
                  (event.target as HTMLElement | null)?.closest(
                    "[data-no-drag]",
                  )
                )
                  return;
                sortable.onItemPointerDown(mono.id, event);
              }}
              onClick={(event) => {
                if (
                  (event.target as HTMLElement | null)?.closest(
                    "[data-no-drag]",
                  )
                )
                  return;
                if (sortable.consumeClick()) return;
                onOpen(mono.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  id: mono.id,
                  anchor: { x: event.clientX, y: event.clientY },
                });
              }}
            >
              <div
                data-mono-header
                className={`relative flex w-full min-w-0 items-stretch ${
                  directory ? "" : "h-full"
                }`}
              >
                <button
                  type="button"
                  title={[look.name, projects, status]
                    .filter(Boolean)
                    .join("\n")}
                  aria-label={[
                    look.name,
                    status ?? "idle",
                    unseen ? unreadLabel(unseen) : undefined,
                    projects,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  aria-current={selected ? "true" : undefined}
                  className={`flex min-w-0 flex-1 cursor-default items-center gap-2 text-left transition-[padding] duration-150 motion-reduce:transition-none ${
                    directory
                      ? "min-h-14 py-2 pr-14 focus-visible:outline-none"
                      : "pr-9 group-hover:pr-16 group-has-[button:focus-visible]:pr-16"
                  } ${selected ? "" : "opacity-65"}`}
                >
                  <PixelMascot
                    name={look.mascot}
                    color={look.color}
                    status={state.status}
                    still={state.status === "idle"}
                    className={
                      directory ? "size-8 shrink-0" : "size-4 shrink-0"
                    }
                  />
                  {state.status === "working" ? (
                    <Shimmer
                      as="span"
                      duration={1.4}
                      className={
                        directory
                          ? "min-w-0 flex-1 break-all text-[15px] font-medium leading-5"
                          : "min-w-0 flex-1 truncate text-sm font-medium leading-tight"
                      }
                    >
                      {look.name}
                    </Shimmer>
                  ) : (
                    <span
                      className={
                        directory
                          ? "min-w-0 flex-1 break-all text-[15px] font-medium leading-5"
                          : "min-w-0 flex-1 truncate text-sm font-medium leading-tight"
                      }
                    >
                      {look.name}
                    </span>
                  )}
                </button>
                <MonoStatusDot
                  status={state.status}
                  count={unseen}
                  className={
                    directory
                      ? "right-10 top-1/2 size-2 -translate-y-1/2"
                      : "right-3 top-1/2 size-2 translate-x-1/2 -translate-y-1/2"
                  }
                />
                <button
                  type="button"
                  data-no-drag
                  title="Mono options"
                  aria-label={`${look.name} options`}
                  aria-haspopup="menu"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenu({ id: mono.id, anchor: event.currentTarget });
                  }}
                  className={`absolute top-1/2 size-6 -translate-y-1/2 place-items-center rounded-md text-content/55 hover:bg-content/8 hover:text-content ${
                    directory
                      ? "right-2 grid"
                      : "right-7 hidden group-hover:grid group-has-[button:focus-visible]:grid"
                  }`}
                >
                  <MoreHorizontal className="size-4" strokeWidth={1.75} />
                </button>
              </div>
              {directory && scopes.length ? (
                <MonoProjectScopes scopes={scopes} projects={look.projects} />
              ) : null}
            </div>
          );
        })}
      </div>
      {menu ? (
        <MonoMenu
          key={menu.id}
          monoId={menu.id}
          anchor={menu.anchor}
          onBackground={() => {
            setMenu(undefined);
            setBackground(menu.id);
          }}
          onDelete={() => {
            setMenu(undefined);
            onDelete(menu.id);
          }}
          onClose={() => setMenu(undefined)}
        />
      ) : null}
      {backgroundMono ? (
        <ProjectBackgroundDialog
          project={monoBackgroundKey(backgroundMono.id)}
          name={monoLook(backgroundMono).name}
          locked
          onClose={() => setBackground(undefined)}
        />
      ) : null}
    </div>
  );
}

function MonoProjectScopes({
  scopes,
  projects,
}: {
  scopes: readonly MonoProjectScope[];
  projects: readonly { path: string; name: string }[];
}) {
  const labels = loadTabGroupLabels();
  const colors = loadTabGroupColors();
  const customColors = loadTabGroupCustomColors();
  const mascots = loadTabGroupMascots();
  const names = new Map(
    projects.map((project) => [pathKey(project.path), project.name]),
  );
  return (
    <div
      className="mb-1 flex w-full min-w-0 flex-col pl-10"
      data-mono-project-scopes
    >
      {scopes.map((scope) => {
        const key = projectKey(scope.path);
        const name =
          names.get(pathKey(scope.path)) ??
          resolveTabGroupLabel(key, labels, projectName(scope.path));
        const active = scope.status !== "idle";
        const status = active ? MONO_STATUS_LABEL[scope.status] : undefined;
        const detail = [
          active ? status : "Last worked project",
          prettyCwd(scope.path),
        ].join(", ");
        return (
          <div
            key={key}
            data-mono-project-scope
            data-mono-project-status={scope.status}
            role="note"
            aria-label={`${detail}: ${name}`}
            title={scope.path}
            className={`flex min-w-0 items-start gap-2 px-2 py-1 ${
              active ? "text-content/65" : "text-content/40"
            }`}
          >
            <ProjectMascot
              project={projectName(scope.path)}
              color={resolveTabGroupColor(
                key,
                colors,
                customColors,
                projectName(scope.path),
              )}
              name={resolveTabGroupMascot(key, mascots)}
              active={scope.status === "working"}
              className="mt-0.5 size-3.5 shrink-0"
            />
            <span className="min-w-0 flex-1">
              <span className="block break-all text-[13px] leading-4">
                {name}
              </span>
              {status ? (
                <span className="block pt-0.5 text-[11px] leading-4 text-content/50">
                  {status}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Right-click menu for a Mono, like a project's: its name, mascot and color
 * up top, edited in place, then the actions.
 */
function MonoMenu({
  monoId,
  anchor,
  onBackground,
  onDelete,
  onClose,
}: {
  monoId: string;
  anchor: PopoverAnchor;
  onBackground: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  useSyncExternalStore(subscribeMonos, monosSnapshot);
  const mono = findMono(monoId);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(mono?.name ?? "");

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  if (!mono) return null;
  const look = monoLook(mono);
  const commitName = () => {
    const next = name.trim().slice(0, 40);
    if (next !== (findMono(monoId)?.name ?? "")) saveMonoName(monoId, next);
  };

  return (
    <Popover
      anchor={anchor}
      side="right"
      align="start"
      gap={0}
      width={280}
      constrainHeight={false}
      onDismiss={() => {
        commitName();
        onClose();
      }}
      role="menu"
      aria-label="Mono options"
      onContextMenu={(event) => event.preventDefault()}
      className="p-2"
    >
      <input
        ref={input}
        value={name}
        placeholder={defaultMonoName(mono.mascot)}
        maxLength={40}
        aria-label="Mono name"
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commitName();
          onClose();
        }}
        className="mb-2 w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-1.5 text-[13px] text-content outline-none ring-accent/40 placeholder:text-content/45 focus:ring-1"
      />
      <div className="mb-2 flex flex-col gap-2">
        <MascotPicker
          current={look.mascot}
          color={look.color}
          onPick={(mascot) => saveMonoMascot(monoId, mascot)}
        />
        <ColorPicker
          inline
          current={look.color}
          onPick={(color) => updateMono(monoId, (mono) => ({ ...mono, color }))}
        />
      </div>
      <div role="separator" className="my-1 h-px bg-content/10" />
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          commitName();
          onBackground();
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-content/85 hover:bg-content/8"
      >
        <ImagePlus className="size-3.5 shrink-0" strokeWidth={1.75} />
        Background image
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-red-400 hover:bg-content/8"
      >
        <Trash2 className="size-3.5 shrink-0" strokeWidth={1.75} />
        Delete mono…
      </button>
    </Popover>
  );
}
