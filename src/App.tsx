import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Plus,
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  ArrowUpRight,
  ArrowRight,
  X,
  Check,
  ChevronDown,
  Image,
  Layers,
  Settings2,
  LogOut,
  Heart,
  Loader2,
  Download,
  Pencil,
  RefreshCw,
  Copy,
  Command,
  Wand2,
  CircleHelp,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Trash2,
  Eye,
  EyeOff,
  Plug,
  PanelLeftClose,
} from "lucide-react";
import {
  defaultOptions,
  taskStatus,
  type Task,
  type Provider,
  type Settings,
  type User,
  type Model,
  type Options,
  type Result,
} from "../shared/types";
import { api } from "./api";
import { EstimateCache } from "./estimate-cache";
import { initialModels, lastModelsKey } from "./model-selection";
import { costLabel, unknownCost, type CostEstimate } from "../shared/pricing";

const statusLabels = {
  completed: "已完成",
  running: "生成中",
  failed: "失败",
  partial: "部分完成",
  queued: "排队中",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
function Logo() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        f<span>↗</span>
      </span>
      <span>
        frame<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
function Status({ status }: { status: keyof typeof statusLabels }) {
  return (
    <span className={"status " + status}>
      <i />
      {statusLabels[status]}
    </span>
  );
}
function Modal({
  children,
  title,
  subtitle,
  close,
  wide = false,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === "Escape") close();
      if (e.key !== "Tab") return;
      const nodes = ref.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, textarea, select, a[href], [tabindex="0"]',
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === ref.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={close} aria-label="关闭">
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [boot, setBoot] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const [demo, setDemo] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings>({
    providers: [],
    textModel: null,
  });
  const [page, setPage] = useState<"tasks" | "favorites" | "settings">("tasks");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [layout, setLayout] = useState("grid");
  const [create, setCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const [sort, setSort] = useState("new");
  const [providerEdit, setProviderEdit] = useState<Provider | "new" | null>(
    null,
  );
  const [mobileNav, setMobileNav] = useState(false);
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    api<{ user: User | null; setupRequired: boolean }>("/auth/me")
      .then((data) => {
        setUser(data.user);
        setSetupRequired(data.setupRequired);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBoot(false));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!user || demo) return;
    let disposed = false;
    const refresh = async () => {
      try {
        const [t, s] = await Promise.all([
          api<Task[]>("/tasks"),
          api<Settings>("/settings"),
        ]);
        if (!disposed) {
          setTasks(t);
          setSettings(s);
          setError("");
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 2500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [user, demo]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k" && user) {
        e.preventDefault();
        setCreate(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [user]);
  async function logout() {
    try {
      if (!demo) await api("/auth/logout", "POST");
      setUser(null);
      setDemo(false);
      setTasks([]);
      setSettings({ providers: [], textModel: null });
      setPage("tasks");
      setSelectedId(null);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function updateTask(t: Task) {
    setTasks((old) =>
      [t, ...old.filter((x) => x.id !== t.id)].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    );
  }
  async function favorite(t: Task) {
    try {
      updateTask(
        demo
          ? { ...t, favorite: !t.favorite }
          : await api<Task>("/tasks/" + t.id, "PATCH", {
              favorite: !t.favorite,
            }),
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const selected = tasks.find((t) => t.id === selectedId);
  const filtered = tasks
    .filter(
      (t) =>
        (page !== "favorites" || t.favorite) &&
        (filter === "all" || taskStatus(t) === filter) &&
        (t.title + t.prompt + t.results.map((r) => r.modelName).join(" "))
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "new"
        ? b.createdAt.localeCompare(a.createdAt)
        : a.createdAt.localeCompare(b.createdAt),
    );
  const running = tasks.filter((t) => taskStatus(t) === "running").length;
  if (boot)
    return (
      <div className="boot">
        <Logo />
        <Loader2 className="spin" />
      </div>
    );
  if (!user)
    return (
      <>
        <Auth
          onUser={(u) => {
            setUser(u);
            setSetupRequired(false);
          }}
          setupRequired={setupRequired}
          connectionError={error}
        />
      </>
    );
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (mobileNav ? "mobile-open" : "")}>
        <Logo />
        <div className="workspace">
          <span className="workspace-avatar">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>个人工作空间</strong>
            <small>{demo ? "演示模式" : "Personal workspace"}</small>
          </div>
          <button
            className="icon-button mobile-only"
            aria-label="关闭导航"
            onClick={() => setMobileNav(false)}
          >
            <X size={16} />
          </button>
        </div>
        <p className="nav-label">工作台</p>
        <nav>
          <button
            className={page === "tasks" ? "active" : ""}
            onClick={() => {
              setPage("tasks");
              setMobileNav(false);
            }}
          >
            <Layers size={18} />
            全部任务<span>{tasks.length}</span>
          </button>
          <button
            className={page === "favorites" ? "active" : ""}
            onClick={() => {
              setPage("favorites");
              setMobileNav(false);
            }}
          >
            <Heart size={18} />
            我的收藏<span>{tasks.filter((t) => t.favorite).length}</span>
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => {
              setPage("settings");
              setMobileNav(false);
            }}
          >
            <SlidersHorizontal size={18} />
            模型配置
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div className="note-mark">
              <Image size={21} />
            </div>
            <strong>好作品，从一个想法开始。</strong>
            <p>让不同模型，带来更多可能。</p>
            <button onClick={() => setCreate(true)}>
              开始创作 <ArrowUpRight size={15} />
            </button>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            使用指南
            <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="user-avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{demo ? "仅预览 · 无真实调用" : user.username}</small>
            </div>
            <button
              className="icon-button"
              onClick={logout}
              title="退出登录"
              aria-label="退出登录"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-only"
              aria-label="打开导航"
              onClick={() => setMobileNav(true)}
            >
              <PanelLeftClose size={19} />
            </button>
            工作空间<span>/</span>
            <strong>
              {page === "settings"
                ? "模型配置"
                : page === "favorites"
                  ? "我的收藏"
                  : "全部任务"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="connection">
              <i />
              {demo ? "演示工作区" : "工作空间已连接"}
            </span>
            <button
              className="icon-button"
              onClick={() => setHelp(true)}
              title="使用指南"
              aria-label="使用指南"
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </div>
        <div className="content">
          {error && (
            <div className="error-banner">
              <AlertCircle size={16} />
              {error}
            </div>
          )}
          {page === "settings" ? (
            <SettingsPage
              settings={settings}
              setSettings={setSettings}
              edit={setProviderEdit}
              demo={demo}
              notify={notify}
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR CREATIVE SPACE</div>
                  <h1>
                    {page === "favorites"
                      ? "值得留住的灵感"
                      : "让想法，成为画面"}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {page === "favorites"
                      ? "收藏喜欢的作品，随时回到创作的那一刻。"
                      : "从一段描述开始，探索不同模型的表达。"}
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setCreate(true)}
                >
                  <Plus size={18} />
                  新建任务
                  <span className="shortcut">
                    <Command size={12} /> K
                  </span>
                </button>
              </div>
              {demo && (
                <div className="demo-banner">
                  <span>
                    <Eye size={15} />
                    当前为交互演示，作品为示例摄影素材，不代表模型生成结果。
                  </span>
                  <button onClick={logout}>
                    登录并开始使用 <ArrowRight size={14} />
                  </button>
                </div>
              )}
              <div className="task-toolbar">
                <div className="tabs">
                  {[
                    ["all", "全部任务"],
                    ["running", "进行中"],
                    ["completed", "已完成"],
                    ["failed", "失败"],
                    ["partial", "部分完成"],
                  ].map(([v, label]) => (
                    <button
                      key={v}
                      className={filter === v ? "selected" : ""}
                      onClick={() => setFilter(v)}
                    >
                      {label}
                      {v === "all" && <span>{tasks.length}</span>}
                      {v === "running" && running > 0 && <span>{running}</span>}
                    </button>
                  ))}
                </div>
                <div className="toolbar-controls">
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="搜索任务"
                      placeholder="搜索任务或提示词"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                      <button
                        className="icon-button"
                        onClick={() => setQuery("")}
                        aria-label="清空搜索"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </label>
                  <div className="view-toggle">
                    <button
                      className={layout === "grid" ? "selected" : ""}
                      onClick={() => setLayout("grid")}
                      aria-label="网格视图"
                    >
                      <LayoutGrid size={17} />
                    </button>
                    <button
                      className={layout === "list" ? "selected" : ""}
                      onClick={() => setLayout("list")}
                      aria-label="列表视图"
                    >
                      <List size={18} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="section-meta">
                <span>
                  {page === "favorites" ? "收藏作品" : "最近创作"}{" "}
                  <b>{filtered.length}</b>
                </span>
                <label className="sort">
                  <select
                    aria-label="排序"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="new">最近创建</option>
                    <option value="old">最早创建</option>
                  </select>
                  <ChevronDown size={13} />
                </label>
              </div>
              {filtered.length ? (
                <div
                  className={
                    "task-grid " + (layout === "list" ? "list-view" : "")
                  }
                >
                  {filtered.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      open={() => setSelectedId(t.id)}
                      favorite={() => favorite(t)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-illustration">
                    <Image size={35} />
                    <span>
                      <Plus size={16} />
                    </span>
                  </div>
                  <h3>
                    {query || filter !== "all"
                      ? "没有找到匹配的任务"
                      : page === "favorites"
                        ? "把喜欢的作品留在这里"
                        : "第一张作品，从这里开始"}
                  </h3>
                  <p>
                    {query || filter !== "all"
                      ? "试试其他关键词，或切换任务状态。"
                      : page === "favorites"
                        ? "点击作品上的爱心，就能在这里找到它。"
                        : "添加一个图像模型，写下想法，让画面慢慢浮现。"}
                  </p>
                  {!query && filter === "all" && page !== "favorites" && (
                    <button
                      className="button primary"
                      onClick={() =>
                        settings.providers.length
                          ? setCreate(true)
                          : setPage("settings")
                      }
                    >
                      <Plus size={16} />
                      {settings.providers.length
                        ? "新建任务"
                        : "配置第一个模型"}
                    </button>
                  )}
                </div>
              )}
              <footer className="content-footer">
                <span>FRAME STUDIO</span>
                <span>留一点空间，给想象。</span>
              </footer>
            </>
          )}
        </div>
      </main>
      {create && (
        <CreateTask
          settings={settings}
          demo={demo}
          close={() => setCreate(false)}
          goSettings={() => {
            setCreate(false);
            setPage("settings");
          }}
          onCreated={(t) => {
            updateTask(t);
            setCreate(false);
            setSelectedId(t.id);
            notify("任务已提交，完成后会自动更新");
          }}
        />
      )}
      {selected && (
        <TaskDrawer
          task={selected}
          close={() => setSelectedId(null)}
          demo={demo}
          update={updateTask}
          favorite={() => favorite(selected)}
          notify={notify}
        />
      )}
      {providerEdit && (
        <ProviderForm
          provider={providerEdit === "new" ? undefined : providerEdit}
          demo={demo}
          close={() => setProviderEdit(null)}
          saved={(s) => {
            setSettings(s);
            setProviderEdit(null);
            notify("模型配置已保存");
          }}
        />
      )}
      {help && (
        <Modal
          title="把灵感变成作品"
          subtitle="Frame 使用指南"
          close={() => setHelp(false)}
        >
          <div className="help-content">
            {[
              [
                "01",
                "连接你的模型",
                "在模型配置中填写接入商和 API Key，获取模型列表后勾选需要的模型。",
              ],
              [
                "02",
                "开始一次创作",
                "新建任务，输入提示词并选择一个或多个模型。Ctrl / ⌘ + K 可以快速打开创建窗口。",
              ],
              [
                "03",
                "对比，再细化",
                "点击任务打开详情。每个模型的结果独立展示，点击图片下的编辑即可基于原图继续修改。",
              ],
              [
                "04",
                "让描述更准确",
                "配置文本模型并将其设为提示词优化模型，创建任务时即可预览和应用优化建议。",
              ],
            ].map(([n, t, p]) => (
              <div key={n}>
                <span>{n}</span>
                <section>
                  <h3>{t}</h3>
                  <p>{p}</p>
                </section>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Auth({
  onUser,
  setupRequired,
  connectionError,
}: {
  onUser: (u: User) => void;
  setupRequired: boolean;
  connectionError: string;
}) {
  const [setup, setSetup] = useState(setupRequired);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (setup && data.password !== data.confirmPassword) {
      setError("两次密码不一致");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ user: User }>(
        "/auth/" + (setup ? "setup" : "login"),
        "POST",
        data,
      );
      onUser(r.user);
    } catch (e) {
      setError((e as Error).message);
      try {
        const state = await api<{ setupRequired: boolean }>("/auth/me");
        setSetup(state.setupRequired);
      } catch {
        /* Preserve original request error. */
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Logo />
        <div className="auth-art">
          <div className="art-sun" />
          <div className="art-arch" />
          <div className="art-ball" />
          <span className="art-label">A LITTLE ROOM FOR IMAGINATION.</span>
        </div>
        <div className="auth-caption">
          <span>THE SPACE BETWEEN IDEA & IMAGE</span>
          <h1>
            给想象，
            <br />
            一个成形的空间。
          </h1>
          <p>一个工作台，连接更多创作可能。</p>
        </div>
        <div className="auth-copyright">
          FRAME STUDIO <span>创造，从这里发生。</span>
        </div>
      </div>
      <div className="auth-main">
        <div className="auth-form">
          <span className="eyebrow">
            {setup ? "SET UP YOUR WORKSPACE" : "WELCOME TO FRAME"}
          </span>
          <h2>{setup ? "设置管理员账户" : "欢迎回来"}</h2>
          <p>
            {setup
              ? "首次使用，请设置唯一管理员的用户名和密码。"
              : "使用管理员账户，继续你的创作。"}
          </p>
          <form onSubmit={submit}>
            <label>
              用户名
              <input
                name="username"
                defaultValue="admin"
                required
                maxLength={40}
                pattern="[a-zA-Z0-9_.\-]+"
                title="字母、数字、下划线、点或短横线"
                placeholder="设置管理员用户名"
                autoComplete="username"
                disabled={busy}
              />
            </label>
            <label>
              密码
              <div className="password-input">
                <input
                  type={show ? "text" : "password"}
                  name="password"
                  required
                  minLength={10}
                  maxLength={128}
                  placeholder="至少 10 位字符"
                  autoComplete={setup ? "new-password" : "current-password"}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={show ? "隐藏密码" : "显示密码"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>
            {setup && (
              <label>
                确认密码
                <input
                  name="confirmPassword"
                  type={show ? "text" : "password"}
                  required
                  minLength={10}
                  maxLength={128}
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  disabled={busy}
                />
              </label>
            )}
            {(error || connectionError) && (
              <div className="inline-error" role="alert">
                {error || connectionError}
              </div>
            )}
            <button
              className="button primary full"
              disabled={busy || !!connectionError}
            >
              {busy && <Loader2 size={17} className="spin" />}
              {setup ? "保存并进入工作台" : "进入工作台"}
              <ArrowRight size={17} />
            </button>
          </form>
          <small className="auth-footnote">
            {setup
              ? "只需设置一次，无需邮箱。用户名可自定义。"
              : "仅管理员可访问此工作空间。"}
          </small>
        </div>
        <div className="auth-bottom">专注创作，其余交给 Frame。</div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  open,
  favorite,
}: {
  task: Task;
  open: () => void;
  favorite: () => void;
}) {
  const images = task.results.flatMap((r) => r.images);
  const models = new Set(task.results.map((r) => r.providerId + r.modelId))
    .size;
  return (
    <article className="task-card">
      <button
        className="card-image"
        onClick={open}
        aria-label={"查看任务：" + task.title}
      >
        {images[0] ? (
          <img src={images[0]} alt={task.title} loading="lazy" />
        ) : (
          <div className={"image-placeholder " + taskStatus(task)}>
            {taskStatus(task) === "running" ? (
              <>
                <Loader2 className="spin" size={28} />
                <span>正在将想法变成画面</span>
              </>
            ) : (
              <>
                <Image size={30} />
                <span>生成未完成</span>
              </>
            )}
          </div>
        )}
        <span className="card-image-count">
          <Layers size={13} />
          {images.length || "—"}
        </span>
        <span className="card-open">
          <ArrowUpRight size={18} />
        </span>
      </button>
      <button
        className={"card-favorite " + (task.favorite ? "liked" : "")}
        onClick={favorite}
        aria-label={task.favorite ? "取消收藏" : "收藏作品"}
      >
        <Heart size={16} fill={task.favorite ? "currentColor" : "none"} />
      </button>
      <div className="card-body">
        <div className="card-title">
          <button onClick={open}>{task.title}</button>
          <Status status={taskStatus(task)} />
        </div>
        <p>{task.prompt}</p>
        <div className="card-meta">
          <span>
            <span className="tiny-model">
              {models > 1 ? <Layers size={11} /> : "◈"}
            </span>
            {models > 1 ? `${models} 个模型` : task.results[0]?.modelName}
          </span>
          <time>{date(task.createdAt)}</time>
        </div>
      </div>
    </article>
  );
}

function CreateTask({
  settings,
  demo,
  close,
  goSettings,
  onCreated,
}: {
  settings: Settings;
  demo: boolean;
  close: () => void;
  goSettings: () => void;
  onCreated: (t: Task) => void;
}) {
  const available = settings.providers.flatMap((p) =>
    p.models.filter((m) => m.kind === "image").map((m) => ({ p, m })),
  );
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [models, setModels] = useState<string[]>(() => {
    try {
      return initialModels(
        settings,
        demo ? null : localStorage.getItem(lastModelsKey),
      );
    } catch {
      return initialModels(settings, null);
    }
  });
  const [options, setOptions] = useState<Options>({ ...defaultOptions });
  const estimateCache = useRef(new EstimateCache());
  const [, refreshEstimates] = useState(0);
  const parameterKey = JSON.stringify({ options, prompt });
  const selectionKey = JSON.stringify(models);
  const cacheKey = (id: string) => JSON.stringify([id, parameterKey]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (demo) return;
      for (const id of models) {
        const key = JSON.stringify([id, parameterKey]);
        if (estimateCache.current.read(key)) continue;
        estimateCache.current
          .get(key, async () => {
            const [providerId, modelId] = id.split("|");
            try {
              const rows = await api<{ id: string; cost: CostEstimate }[]>(
                "/estimates",
                "POST",
                {
                  models: [{ providerId, modelId }],
                  options,
                  prompt,
                },
              );
              return rows.find((row) => row.id === id)?.cost || unknownCost();
            } catch {
              return unknownCost("获取预估失败，可继续生成");
            }
          })
          .then(() => {
            if (active) refreshEstimates((value) => value + 1);
          });
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectionKey, parameterKey, demo]);
  const currentCosts = Object.fromEntries(
    models.map((id) => [id, estimateCache.current.read(cacheKey(id))]),
  );
  const estimatesPending = models.some((id) => !currentCosts[id]);
  const knownCosts = models
    .map((id) => currentCosts?.[id])
    .filter((cost): cost is CostEstimate => !!cost && cost.minUsd !== null);
  const totalCost: CostEstimate = {
    minUsd: knownCosts.length
      ? knownCosts.reduce((sum, cost) => sum + cost.minUsd!, 0)
      : null,
    maxUsd: knownCosts.length
      ? knownCosts.reduce((sum, cost) => sum + cost.maxUsd!, 0)
      : null,
    partial:
      knownCosts.length < models.length ||
      knownCosts.some((cost) => cost.partial),
    detail: "",
  };
  const [busy, setBusy] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [optimized, setOptimized] = useState("");
  const [error, setError] = useState("");
  async function optimizePrompt() {
    setOptimizing(true);
    setError("");
    try {
      if (demo) throw new Error("演示不调用真实模型，请登录后配置文本模型。");
      const r = await api<{ prompt: string }>("/optimize", "POST", { prompt });
      setOptimized(r.prompt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOptimizing(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (demo)
        throw new Error(
          "演示仅供预览。请退出演示，注册并配置 API Key 后生成真实图片。",
        );
      const created = await api<Task>("/tasks", "POST", {
        prompt,
        title,
        options,
        models: models.map((s) => {
          const [providerId, modelId] = s.split("|");
          return { providerId, modelId };
        }),
      });
      try {
        localStorage.setItem(lastModelsKey, JSON.stringify(models));
      } catch {
        /* Storage restrictions must not block generation. */
      }
      onCreated(created);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="开始一次新创作"
      subtitle="描述你的想法，让不同模型各展所长。"
      close={close}
      wide
    >
      <form onSubmit={submit} className="create-form">
        <label>
          任务名称 <span className="optional">选填</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="给这次创作起个名字"
            maxLength={80}
          />
        </label>
        <div className="field-label">
          <label htmlFor="prompt">画面描述</label>
          <button
            type="button"
            className="text-button optimize"
            disabled={!settings.textModel || !prompt.trim() || optimizing}
            title={
              !settings.textModel
                ? "请先在模型配置中选择文本模型"
                : "优化提示词"
            }
            onClick={optimizePrompt}
          >
            {optimizing ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Wand2 size={14} />
            )}
            优化提示词
          </button>
        </div>
        <textarea
          id="prompt"
          className="prompt-input"
          required
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={10000}
          placeholder="试着描述主体、场景、光线和风格。比如：一只手工陶瓷花瓶，午后阳光，米白色背景，极简静物摄影……"
        />
        <div className="field-hint">
          <span>
            {settings.textModel
              ? "已连接文本模型，可优化你的描述"
              : "配置文本模型后，可使用提示词优化"}
          </span>
          <span>{prompt.length} / 10000</span>
        </div>
        {optimized && (
          <div className="optimized-preview">
            <strong>优化建议</strong>
            <p>{optimized}</p>
            <div>
              <button
                type="button"
                className="text-button"
                onClick={() => setOptimized("")}
              >
                保留原文
              </button>
              <button
                type="button"
                className="button small primary"
                onClick={() => {
                  setPrompt(optimized);
                  setOptimized("");
                }}
              >
                应用建议
                <Check size={14} />
              </button>
            </div>
          </div>
        )}
        <div className="field-label model-label">
          <label>
            生成模型 <span className="optional">可多选 · 最多 10 个</span>
          </label>
          <button type="button" className="text-button" onClick={goSettings}>
            管理模型
            <ArrowUpRight size={13} />
          </button>
        </div>
        {available.length ? (
          <div className="model-choices" role="group" aria-label="生成模型">
            {available.map(({ p, m }) => {
              const id = p.id + "|" + m.id;
              const checked = models.includes(id);
              return (
                <button
                  type="button"
                  key={id}
                  aria-pressed={checked}
                  className={"model-choice " + (checked ? "checked" : "")}
                  onClick={() =>
                    setModels((old) =>
                      checked
                        ? old.filter((x) => x !== id)
                        : old.length < 10
                          ? [...old, id]
                          : old,
                    )
                  }
                >
                  <span className="model-logo">
                    {p.type === "openai" ? "◈" : "↗"}
                  </span>
                  <span>
                    <strong>{m.name}</strong>
                    <small>
                      {p.name} · {m.id}
                    </small>
                  </span>
                  {checked && (
                    <span
                      className="model-cost"
                      title={currentCosts?.[id]?.detail}
                    >
                      {demo
                        ? "演示"
                        : currentCosts[id]
                          ? costLabel(currentCosts[id] || unknownCost())
                          : "估价中…"}
                    </span>
                  )}
                  <span className="checkbox">
                    {checked && <Check size={12} />}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="no-models">
            <Plug size={22} />
            <span>先连接一个图像模型</span>
            <button type="button" className="text-button" onClick={goSettings}>
              前往配置
              <ArrowRight size={14} />
            </button>
          </div>
        )}
        <div className="option-grid">
          <label>
            画面比例
            <select
              value={options.size}
              onChange={(e) =>
                setOptions({
                  ...options,
                  size: e.target.value as Options["size"],
                })
              }
            >
              <option value="1024x1024">1:1 · 方形</option>
              <option value="1536x1024">3:2 · 横向</option>
              <option value="1024x1536">2:3 · 竖向</option>
            </select>
          </label>
          <label>
            每个模型张数
            <select
              value={options.count}
              onChange={(e) =>
                setOptions({ ...options, count: +e.target.value })
              }
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} 张
                </option>
              ))}
            </select>
          </label>
          <label>
            画质
            <select
              value={options.quality}
              onChange={(e) =>
                setOptions({
                  ...options,
                  quality: e.target.value as Options["quality"],
                })
              }
            >
              <option value="auto">自动</option>
              <option value="low">低</option>
              <option value="medium">标准</option>
              <option value="high">高</option>
            </select>
          </label>
          <label>
            背景
            <select
              value={options.background}
              onChange={(e) =>
                setOptions({
                  ...options,
                  background: e.target.value as Options["background"],
                })
              }
            >
              <option value="auto">自动</option>
              <option value="opaque">不透明</option>
              <option value="transparent">透明</option>
            </select>
          </label>
        </div>
        <p className="field-hint">
          尺寸、画质和透明背景需模型支持。OpenRouter
          专用图片模型支持画质与背景参数，具体以模型能力为准。
        </p>
        <div className="cost-summary" aria-live="polite">
          <div>
            <span>
              预计费用 <small>USD</small>
            </span>
            <strong>
              {!models.length
                ? "请选择模型"
                : demo
                  ? "演示不计费"
                  : estimatesPending
                    ? "正在获取价格…"
                    : costLabel(totalCost)}
            </strong>
          </div>
          <p>
            按所选模型与张数合计，实际费用以接入商账单为准。未提供明确价格的模型不按免费计算。
          </p>
          {models.some((id) => currentCosts[id]) && (
            <details>
              <summary>查看估算依据</summary>
              {models.map((id) => (
                <p key={id}>
                  <b>
                    {
                      available.find(
                        (item) => item.p.id + "|" + item.m.id === id,
                      )?.m.name
                    }
                  </b>
                  ：{currentCosts[id]?.detail || "费用待确认"}
                </p>
              ))}
            </details>
          )}
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <span>
            将提交 {models.length} 个模型 · 预计 {models.length * options.count}{" "}
            张图片
          </span>
          <button
            className="button primary"
            disabled={busy || !prompt.trim() || !models.length}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ArrowUpRight size={16} />
            )}
            生成图片
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskDrawer({
  task,
  close,
  demo,
  update,
  favorite,
  notify,
}: {
  task: Task;
  close: () => void;
  demo: boolean;
  update: (t: Task) => void;
  favorite: () => void;
  notify: (s: string) => void;
}) {
  const [edit, setEdit] = useState<{ result: Result; image: string } | null>(
    null,
  );
  const [changes, setChanges] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const [versionSelection, setVersionSelection] = useState<
    Record<string, { latest: string; selected: string }>
  >({});
  const groups = [
    ...new Set(task.results.map((r) => r.providerId + "|" + r.modelId)),
  ];
  async function submitEdit(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setError("");
    try {
      if (demo) throw new Error("演示模式不会提交图片编辑，请登录后使用。");
      update(
        await api<Task>(`/tasks/${task.id}/edit`, "POST", {
          resultId: edit.result.id,
          image: edit.image,
          changes,
        }),
      );
      setEdit(null);
      setChanges("");
      notify("修改已提交，原始图片会保留");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry(r: Result) {
    try {
      update(await api<Task>(`/tasks/${task.id}/retry/${r.id}`, "POST"));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function download(url: string) {
    try {
      if (demo) {
        notify("示例素材不提供下载，真实生成结果支持原图下载。");
        return;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error("下载失败");
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download =
        task.title.replace(/[<>:"/\\|?*]/g, "_") +
        "." +
        (blob.type.split("/")[1] || "png");
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
    } catch {
      notify("下载失败，请稍后重试");
    }
  }
  return (
    <div className="drawer-container">
      <Modal
        title={task.title}
        subtitle={date(task.createdAt) + " 创建"}
        close={close}
        wide
      >
        <div className="drawer-toolbar">
          <Status status={taskStatus(task)} />
          <span>
            {task.options.size} ·{" "}
            {task.options.quality === "auto"
              ? "自动画质"
              : task.options.quality}
          </span>
          <button
            className={"text-button " + (task.favorite ? "liked" : "")}
            onClick={favorite}
          >
            <Heart size={15} fill={task.favorite ? "currentColor" : "none"} />
            {task.favorite ? "已收藏" : "收藏"}
          </button>
        </div>
        <div className="prompt-display">
          <div>
            <span>原始提示词</span>
            <button
              className="icon-button"
              title="复制提示词"
              aria-label="复制提示词"
              onClick={() =>
                navigator.clipboard
                  .writeText(task.prompt)
                  .then(() => notify("提示词已复制"))
                  .catch(() => notify("复制失败，请手动选择文本"))
              }
            >
              <Copy size={15} />
            </button>
          </div>
          <p>{task.prompt}</p>
        </div>
        <div className="results-heading">
          <h3>
            生成结果 <span>{task.results.flatMap((r) => r.images).length}</span>
          </h3>
          <small>
            {groups.length > 1
              ? "同一提示词，不同模型的表达"
              : "每一次修改，都保留一个版本"}
          </small>
        </div>
        <div
          className={"result-columns " + (groups.length > 1 ? "multiple" : "")}
        >
          {groups.map((group) => {
            const results = task.results.filter(
              (r) => r.providerId + "|" + r.modelId === group,
            );
            const versions = results
              .map((result, index) => ({ result, index }))
              .reverse();
            const latest = versions[0].result.id;
            const selection = versionSelection[group];
            const selected =
              selection?.latest === latest &&
              results.some((r) => r.id === selection.selected)
                ? selection.selected
                : latest;
            return (
              <section className="model-results" key={group}>
                <header>
                  <span className="model-logo">◈</span>
                  <div>
                    <strong>{results[0].modelName}</strong>
                    <small>{results[0].providerName}</small>
                  </div>
                  <span className="version-count">{results.length} 个版本</span>
                </header>
                <div
                  className="result-version-tabs"
                  role="tablist"
                  aria-label={results[0].modelName + " 结果版本"}
                >
                  {versions.map(({ result: r, index }, tabIndex) => (
                    <button
                      key={r.id}
                      id={"version-tab-" + r.id}
                      role="tab"
                      type="button"
                      aria-selected={r.id === selected}
                      aria-controls={"version-panel-" + r.id}
                      tabIndex={r.id === selected ? 0 : -1}
                      onClick={() =>
                        setVersionSelection((old) => ({
                          ...old,
                          [group]: { latest, selected: r.id },
                        }))
                      }
                      onKeyDown={(event) => {
                        const next =
                          event.key === "ArrowRight"
                            ? (tabIndex + 1) % versions.length
                            : event.key === "ArrowLeft"
                              ? (tabIndex - 1 + versions.length) %
                                versions.length
                              : event.key === "Home"
                                ? 0
                                : event.key === "End"
                                  ? versions.length - 1
                                  : -1;
                        if (next < 0) return;
                        event.preventDefault();
                        const target = versions[next].result.id;
                        setVersionSelection((old) => ({
                          ...old,
                          [group]: { latest, selected: target },
                        }));
                        document
                          .getElementById("version-tab-" + target)
                          ?.focus();
                      }}
                    >
                      {index === 0 ? "原始版本" : `修改版本 ${index}`}
                      {tabIndex === 0 && index > 0 ? " · 最新" : ""}
                    </button>
                  ))}
                </div>
                <div className="result-version-panels">
                  {versions.map(({ result: r, index }) => (
                    <div
                      className={
                        "result-version version-panel " +
                        (r.id === selected ? "active" : "")
                      }
                      key={r.id}
                      role="tabpanel"
                      id={"version-panel-" + r.id}
                      aria-labelledby={"version-tab-" + r.id}
                      aria-hidden={r.id !== selected}
                      inert={r.id !== selected}
                    >
                      <div className="version-label">
                        <span>
                          {index === 0 ? "原始版本" : `修改版本 ${index}`}
                          {r.elapsed && (
                            <small> · {(r.elapsed / 1000).toFixed(1)}s</small>
                          )}
                        </span>
                        <Status status={r.status} />
                      </div>
                      <div
                        className="version-change-note"
                        title={r.changes || "原始提示词生成"}
                      >
                        {r.changes || "原始提示词生成"}
                      </div>
                      {r.status === "running" || r.status === "queued" ? (
                        <div className="result-loading">
                          <Loader2 size={24} className="spin" />
                          <strong>
                            {r.status === "queued"
                              ? "等待生成"
                              : "正在生成画面"}
                          </strong>
                          <p>你可以关闭抽屉，任务会在后台继续。</p>
                        </div>
                      ) : r.status === "failed" ? (
                        <div className="result-error">
                          <AlertCircle size={25} />
                          <strong>这次生成没有完成</strong>
                          <p>{r.error}</p>
                          <button
                            className="button secondary small"
                            onClick={() => retry(r)}
                          >
                            <RefreshCw size={14} />
                            重试此模型
                          </button>
                        </div>
                      ) : (
                        <div className="result-images">
                          {r.images.map((image, i) => (
                            <div className="result-image" key={image}>
                              <button
                                className="result-image-preview"
                                onClick={() => setZoom(image)}
                                aria-label={"放大图片 " + (i + 1)}
                              >
                                <img
                                  src={image}
                                  alt={
                                    task.title +
                                    " · " +
                                    r.modelName +
                                    " · " +
                                    (i + 1)
                                  }
                                />
                                <span>
                                  <Eye size={16} />
                                  查看原图
                                </span>
                              </button>
                              <div className="image-actions">
                                <span>
                                  图片 {String(i + 1).padStart(2, "0")}
                                </span>
                                <button
                                  className="text-button"
                                  disabled={!r.canEdit}
                                  title={
                                    r.canEdit
                                      ? "基于此图片编辑"
                                      : "此模型未开启编辑支持"
                                  }
                                  onClick={() => {
                                    setEdit({ result: r, image });
                                    setChanges("");
                                    setError("");
                                  }}
                                >
                                  <Pencil size={14} />
                                  编辑
                                </button>
                                <button
                                  className="icon-button"
                                  aria-label="下载图片"
                                  title="下载原图"
                                  onClick={() => download(image)}
                                >
                                  <Download size={15} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </Modal>
      {edit && (
        <Modal
          title="让画面更接近你的想法"
          subtitle={"编辑 · " + edit.result.modelName}
          close={() => setEdit(null)}
        >
          <form className="edit-form" onSubmit={submitEdit}>
            <img src={edit.image} alt="待编辑的原图" />
            <label>
              想修改什么？
              <textarea
                autoFocus
                required
                value={changes}
                onChange={(e) => setChanges(e.target.value)}
                maxLength={10000}
                placeholder="例如：把背景换成浅灰色，保留主体与光线不变。"
              />
            </label>
            <p className="field-hint">
              提交时会同时发送原始提示词、这张图片和修改要求。新结果会保存为独立版本。
            </p>
            {error && <div className="inline-error">{error}</div>}
            <div className="modal-footer">
              <button
                type="button"
                className="button secondary"
                onClick={() => setEdit(null)}
              >
                取消
              </button>
              <button
                disabled={busy || !changes.trim()}
                className="button primary"
              >
                {busy ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <ArrowUpRight size={15} />
                )}
                提交修改
              </button>
            </div>
          </form>
        </Modal>
      )}
      {zoom && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="图片预览"
          onClick={() => setZoom(null)}
        >
          <button
            autoFocus
            className="icon-button"
            aria-label="关闭图片预览"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setZoom(null);
              }
            }}
          >
            <X size={24} />
          </button>
          <img src={zoom} alt={task.title} />
        </div>
      )}
    </div>
  );
}

function SettingsPage({
  settings,
  setSettings,
  edit,
  demo,
  notify,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
  edit: (p: Provider | "new") => void;
  demo: boolean;
  notify: (s: string) => void;
}) {
  const [remove, setRemove] = useState<Provider | null>(null);
  const [busy, setBusy] = useState(false);
  const textModels = settings.providers.flatMap((p) =>
    p.models.filter((m) => m.kind === "text").map((m) => ({ p, m })),
  );
  const imageModels = settings.providers.flatMap((p) =>
    p.models.filter((m) => m.kind === "image").map((m) => ({ p, m })),
  );
  async function chooseDefault(value: string) {
    const [providerId, modelId] = value.split("|");
    const defaultImageModel = value ? { providerId, modelId } : null;
    try {
      if (demo) setSettings({ ...settings, defaultImageModel });
      else
        setSettings(
          await api<Settings>(
            "/settings/default-image-model",
            "PUT",
            defaultImageModel,
          ),
        );
      notify("默认生图模型已更新");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function choose(value: string) {
    try {
      const [providerId, modelId] = value.split("|");
      const textModel = value ? { providerId, modelId } : null;
      if (demo) setSettings({ ...settings, textModel });
      else
        setSettings(
          await api<Settings>("/settings/text-model", "PUT", textModel),
        );
      notify("提示词优化模型已更新");
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function removeProvider() {
    if (!remove) return;
    setBusy(true);
    try {
      if (demo) throw new Error("演示模式的配置不能删除");
      setSettings(await api<Settings>("/providers/" + remove.id, "DELETE"));
      setRemove(null);
      notify("接入商已删除");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECTED POSSIBILITIES</div>
          <h1>
            你的模型，自由组合<span className="heading-dot">.</span>
          </h1>
          <p>连接接入商，在同一个工作台使用你喜欢的模型。</p>
        </div>
        <button className="button primary" onClick={() => edit("new")}>
          <Plus size={17} />
          添加接入商
        </button>
      </div>
      <div className="settings-section-heading">
        <h3>
          模型接入商 <span>{settings.providers.length}</span>
        </h3>
        <span>API Key 加密保存于服务端</span>
      </div>
      <div className="provider-list" aria-label="已连接的接入商">
        {settings.providers.map((p) => (
          <article className="provider-row" key={p.id}>
            <div className="provider-identity">
              <span className="provider-logo">
                {p.type === "openai" ? "◈" : "↗"}
              </span>
              <div>
                <h3 title={p.name}>{p.name}</h3>
                <span>
                  {p.type === "openai" ? "OpenAI 兼容协议" : "OpenRouter 协议"}
                </span>
              </div>
            </div>
            <div className="provider-connection">
              <span className="provider-endpoint" title={p.baseUrl}>
                {p.baseUrl}
              </span>
              <span className="provider-key-state">
                <i />
                {p.hasKey ? "已配置密钥" : "未配置密钥"}
              </span>
            </div>
            <div className="provider-summary">
              <strong>{p.models.length} 个模型</strong>
              <span>
                图像 {p.models.filter((m) => m.kind === "image").length} · 文本{" "}
                {p.models.filter((m) => m.kind === "text").length}
              </span>
            </div>
            <div className="provider-actions">
              <button
                className="button small secondary"
                onClick={() => edit(p)}
                aria-label={"配置 " + p.name}
              >
                <Settings2 size={14} />
                配置
              </button>
              <button
                className="icon-button"
                aria-label={"删除 " + p.name}
                onClick={() => setRemove(p)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
        {!settings.providers.length && (
          <button className="provider-empty" onClick={() => edit("new")}>
            <Plus size={20} />
            <span>添加第一个接入商</span>
            <small>连接 OpenAI、OpenRouter 或兼容接入商</small>
          </button>
        )}
      </div>
      <section className="optimization-settings">
        <div className="optimization-icon">
          <Image size={22} />
        </div>
        <div>
          <h3>默认生图模型</h3>
          <p>
            新建创作优先复用此浏览器上次提交的模型选择；没有有效记录时使用默认模型。
          </p>
          <label className="sr-only" htmlFor="default-image-model">
            默认生图模型
          </label>
          <select
            id="default-image-model"
            value={
              settings.defaultImageModel
                ? settings.defaultImageModel.providerId +
                  "|" +
                  settings.defaultImageModel.modelId
                : ""
            }
            onChange={(e) => chooseDefault(e.target.value)}
          >
            <option value="">未设置 · 选择图像模型</option>
            {imageModels.map(({ p, m }) => (
              <option key={p.id + "|" + m.id} value={p.id + "|" + m.id}>
                {p.name} / {m.name}
              </option>
            ))}
          </select>
          {!imageModels.length && (
            <small>先在任一接入商中添加一个图像模型。</small>
          )}
        </div>
      </section>
      <section className="optimization-settings">
        <div className="optimization-icon">
          <Wand2 size={22} />
        </div>
        <div>
          <h3>提示词优化</h3>
          <p>选择一个文本模型，帮你把想法描述得更准确。</p>
          <label className="sr-only" htmlFor="text-model">
            提示词优化模型
          </label>
          <select
            id="text-model"
            value={
              settings.textModel
                ? settings.textModel.providerId +
                  "|" +
                  settings.textModel.modelId
                : ""
            }
            onChange={(e) => choose(e.target.value)}
          >
            <option value="">未启用 · 选择文本模型</option>
            {textModels.map(({ p, m }) => (
              <option value={p.id + "|" + m.id} key={p.id + "|" + m.id}>
                {p.name} / {m.name}
              </option>
            ))}
          </select>
          {!textModels.length && (
            <small>先在任一接入商中添加一个文本模型。</small>
          )}
        </div>
      </section>
      <div className="settings-note">
        <CircleHelp size={17} />
        <p>
          模型从接入商列表获取并选择。不同模型支持的参数可能不同；图片编辑需要模型本身支持图像输入。
        </p>
      </div>
      {remove && (
        <Modal
          title={"删除 " + remove.name + "？"}
          close={() => setRemove(null)}
        >
          <div className="confirm-content">
            <p>
              将删除该接入商及 API Key。已有作品会保留；再次生成前需要重新配置。
            </p>
            <div className="modal-footer">
              <button
                className="button secondary"
                onClick={() => setRemove(null)}
              >
                取消
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={removeProvider}
              >
                确认删除
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function ProviderForm({
  provider,
  close,
  saved,
  demo,
}: {
  provider?: Provider;
  close: () => void;
  saved: (s: Settings) => void;
  demo: boolean;
}) {
  const [name, setName] = useState(provider?.name || "");
  const [type, setType] = useState<"openai" | "openrouter">(
    provider?.type || "openai",
  );
  const [baseUrl, setBaseUrl] = useState(
    provider?.baseUrl || "https://api.openai.com/v1",
  );
  const [key, setKey] = useState("");
  const [models, setModels] = useState<Model[]>(provider?.models || []);
  const [catalog, setCatalog] = useState<Model[] | null>(null);
  const [query, setQuery] = useState("");
  const [modelKind, setModelKind] = useState<"all" | Model["kind"]>("all");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changedAddress = baseUrl.replace(/\/$/, "") !== provider?.baseUrl;
  const needsKey = !provider || changedAddress;
  const canSaveExisting =
    !!provider &&
    !changedAddress &&
    type === provider.type &&
    models.every((m) => provider.models.some((saved) => saved.id === m.id));
  const unavailable = catalog
    ? models.filter((m) => !catalog.some((c) => c.id === m.id))
    : [];
  function invalidate() {
    setCatalog(null);
    setError("");
  }
  function patch(id: string, value: Partial<Model>) {
    setModels((old) => old.map((m) => (m.id === id ? { ...m, ...value } : m)));
  }
  async function load() {
    setLoading(true);
    setError("");
    setCatalog(null);
    try {
      if (demo) throw new Error("请登录管理员账户后获取模型列表");
      const response = await api<{ models: Model[] }>(
        "/providers/models",
        "POST",
        { providerId: provider?.id, baseUrl, type, apiKey: key || undefined },
      );
      setCatalog(response.models);
      // Refresh old detected capabilities without dropping selected IDs.
      setModels((old) =>
        old.map((m) => response.models.find((item) => item.id === m.id) || m),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if ((!catalog && !canSaveExisting) || unavailable.length) return;
    setBusy(true);
    setError("");
    try {
      saved(
        await api<Settings>(
          "/providers/" + (provider?.id || crypto.randomUUID()),
          "PUT",
          {
            name,
            type,
            baseUrl,
            apiKey: key || undefined,
            models,
            refreshModels: catalog !== null,
          },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selectedById = new Map(models.map((m) => [m.id, m]));
  const visible =
    catalog
      ?.map((m) => selectedById.get(m.id) || m)
      .filter(
        (m) =>
          (modelKind === "all" || m.kind === modelKind) &&
          (m.name + " " + m.id)
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ) || [];
  return (
    <Modal
      title={provider ? "配置接入商" : "添加接入商"}
      subtitle="连接接入商，从模型列表中选择你需要的模型。"
      close={close}
      wide
    >
      <form className="provider-form" onSubmit={submit}>
        <div className="two-columns">
          <label>
            接入商名称
            <input
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：我的 OpenAI"
              disabled={busy || loading}
            />
          </label>
          <label>
            接口协议
            <select
              value={type}
              disabled={busy || loading}
              onChange={(e) => {
                const t = e.target.value as "openai" | "openrouter";
                setType(t);
                setBaseUrl(
                  t === "openai"
                    ? "https://api.openai.com/v1"
                    : "https://openrouter.ai/api/v1",
                );
                invalidate();
              }}
            >
              <option value="openai">OpenAI / 兼容接入商</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
        </div>
        <label>
          API Base URL
          <input
            type="url"
            required
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              invalidate();
            }}
            disabled={busy || loading}
          />
        </label>
        <label>
          API Key
          <input
            type="password"
            autoComplete="new-password"
            required={needsKey}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              invalidate();
            }}
            placeholder={
              needsKey ? "输入接入商的 API Key" : "留空则使用已保存的密钥"
            }
            disabled={busy || loading}
          />
        </label>
        <div className="field-label">
          <label>
            可用模型 <span className="optional">已选 {models.length} 个</span>
          </label>
          <button
            type="button"
            className="button secondary small"
            onClick={load}
            disabled={loading || busy || !baseUrl || (needsKey && !key.trim())}
          >
            {loading ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}{" "}
            {loading ? "正在获取" : catalog ? "刷新列表" : "获取模型列表"}
          </button>
        </div>
        {catalog === null ? (
          <div className="no-models">
            <Plug size={22} />
            <span>
              {loading
                ? "正在读取接入商的模型列表…"
                : canSaveExisting
                  ? "可直接修改或移除已选模型并保存"
                  : "填写连接信息后，点击「获取模型列表」"}
            </span>
            {models.length > 0 && (
              <small>
                现有 {models.length} 个选择已保留，添加其他模型时再获取列表。
              </small>
            )}
          </div>
        ) : (
          <>
            <div className="catalog-controls">
              <label className="search catalog-search">
                <Search size={16} />
                <input
                  aria-label="搜索可用模型"
                  placeholder="搜索模型名称或 ID"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label="筛选模型类型"
                value={modelKind}
                onChange={(e) =>
                  setModelKind(e.target.value as "all" | Model["kind"])
                }
              >
                <option value="all">全部类型</option>
                <option value="image">图像模型</option>
                <option value="text">文本模型</option>
              </select>
            </div>
            <div className="model-catalog">
              {visible.map((m) => {
                const selected = models.some((x) => x.id === m.id);
                return (
                  <label
                    className={"catalog-row " + (selected ? "selected" : "")}
                    key={m.id}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={busy}
                      onChange={() =>
                        setModels((old) =>
                          selected
                            ? old.filter((x) => x.id !== m.id)
                            : [...old, m],
                        )
                      }
                    />
                    <span>
                      <strong>{m.name}</strong>
                      <small>{m.id}</small>
                    </span>
                    <span className="model-type">
                      {m.kind === "image" ? "图像" : "文本"}
                    </span>
                  </label>
                );
              })}
              {!visible.length && (
                <p className="catalog-empty">
                  {catalog.length
                    ? "没有匹配的模型，试试其他关键词或模型类型。"
                    : "接入商返回了空列表，请检查账号权限。"}
                </p>
              )}
            </div>
            <p className="field-hint">
              显示 {visible.length} / 共 {catalog.length}{" "}
              个模型。类型根据接入商信息识别，未提供能力信息时可在下方调整。
            </p>
          </>
        )}
        {models.length > 0 && (
          <div className="selected-models">
            <div className="field-label">
              <label>
                已选模型 <span className="optional">{models.length} 个</span>
              </label>
            </div>
            <div className="selected-model-list">
              {models.map((m) => (
                <div className="selected-model" key={m.id}>
                  <div className="selected-model-title">
                    <strong title={m.name}>{m.name}</strong>
                    <small title={m.id}>{m.id}</small>
                    {unavailable.some((x) => x.id === m.id) && (
                      <span className="inline-error">
                        此模型已不在当前列表，请移除
                      </span>
                    )}
                  </div>
                  <div className="model-editor-bottom">
                    <select
                      aria-label={m.name + " 类型"}
                      value={m.kind}
                      disabled={busy}
                      onChange={(e) =>
                        patch(m.id, {
                          kind: e.target.value as Model["kind"],
                          canEdit: false,
                        })
                      }
                    >
                      <option value="image">图像模型</option>
                      <option value="text">文本模型</option>
                    </select>
                    {m.kind === "image" && (
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={m.canEdit}
                          disabled={busy}
                          onChange={(e) =>
                            patch(m.id, { canEdit: e.target.checked })
                          }
                        />
                        支持编辑
                      </label>
                    )}
                    <button
                      className="icon-button"
                      type="button"
                      disabled={busy}
                      aria-label={"移除 " + m.name}
                      onClick={() =>
                        setModels((old) => old.filter((x) => x.id !== m.id))
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <span>
            {catalog || canSaveExisting
              ? "保存所选模型，即可开始创作"
              : "获取列表后选择模型，再保存配置"}
          </span>
          <button
            className="button primary"
            disabled={
              busy ||
              loading ||
              (!catalog && !canSaveExisting) ||
              (!models.length && !provider) ||
              !!unavailable.length
            }
          >
            {busy ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Check size={15} />
            )}
            保存配置
          </button>
        </div>
      </form>
    </Modal>
  );
}
