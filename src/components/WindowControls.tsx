import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { currentOS } from "../hooks/useOS";

const win = getCurrentWindow();

// Shared stopPropagation handler — prevents the drag region from
// intercepting mousedown events on the control buttons.
function nodrag(e: React.MouseEvent) {
  e.stopPropagation();
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});

    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  async function minimize() {
    await win.minimize();
  }

  async function toggleMaximize() {
    await win.toggleMaximize();
    setMaximized(await win.isMaximized());
  }

  async function hide() {
    await invoke("hide_window");
  }

  if (currentOS === "macos") {
    return <MacOSControls onHide={hide} onMinimize={minimize} onMaximize={toggleMaximize} maximized={maximized} />;
  }
  if (currentOS === "linux") {
    return <LinuxControls onHide={hide} onMinimize={minimize} onMaximize={toggleMaximize} maximized={maximized} />;
  }
  return <WindowsControls onHide={hide} onMinimize={minimize} onMaximize={toggleMaximize} maximized={maximized} />;
}

// ── Shared prop type ──────────────────────────────────────────────────────────

interface ControlProps {
  onHide: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  maximized: boolean;
}

// ── macOS — traffic lights (left side) ───────────────────────────────────────

function MacOSControls({ onHide, onMinimize, onMaximize }: ControlProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex items-center gap-1.5"
      onMouseDown={nodrag}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button onClick={onHide} onMouseDown={nodrag}
        className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 flex items-center justify-center transition-colors"
        title="Hide"
      >
        {hovered && (
          <svg className="w-1.5 h-1.5 text-red-900" fill="none" viewBox="0 0 6 6" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" d="M1 1l4 4M5 1L1 5" />
          </svg>
        )}
      </button>
      <button onClick={onMinimize} onMouseDown={nodrag}
        className="w-3 h-3 rounded-full bg-yellow-400 hover:bg-yellow-300 flex items-center justify-center transition-colors"
        title="Minimize"
      >
        {hovered && (
          <svg className="w-1.5 h-1.5 text-yellow-900" fill="none" viewBox="0 0 6 2" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" d="M0 1h6" />
          </svg>
        )}
      </button>
      <button onClick={onMaximize} onMouseDown={nodrag}
        className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-400 flex items-center justify-center transition-colors"
        title="Maximize"
      >
        {hovered && (
          <svg className="w-1.5 h-1.5 text-green-900" fill="none" viewBox="0 0 6 6" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" d="M1 5V1h4M5 5H1" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Linux — circles on the right, neutral palette ────────────────────────────

function LinuxControls({ onHide, onMinimize, onMaximize, maximized }: ControlProps) {
  return (
    <div className="flex items-center gap-1.5 pr-3" onMouseDown={nodrag}>
      <button onClick={onMinimize} onMouseDown={nodrag}
        className="w-4 h-4 rounded-full bg-neutral-700 hover:bg-neutral-500 flex items-center justify-center transition-colors"
        title="Minimize"
      >
        <svg className="w-2 h-2 text-neutral-300" fill="none" viewBox="0 0 8 2" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" d="M0 1h8" />
        </svg>
      </button>
      <button onClick={onMaximize} onMouseDown={nodrag}
        className="w-4 h-4 rounded-full bg-neutral-700 hover:bg-neutral-500 flex items-center justify-center transition-colors"
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg className="w-2 h-2 text-neutral-300" fill="none" viewBox="0 0 8 8" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" d="M2 6V2h4M6 6H2" />
          </svg>
        ) : (
          <svg className="w-2 h-2 text-neutral-300" fill="none" viewBox="0 0 8 8" stroke="currentColor" strokeWidth={1.5}>
            <rect x="1" y="1" width="6" height="6" rx="0.5" />
          </svg>
        )}
      </button>
      <button onClick={onHide} onMouseDown={nodrag}
        className="w-4 h-4 rounded-full bg-neutral-700 hover:bg-red-500 flex items-center justify-center transition-colors"
        title="Hide"
      >
        <svg className="w-2 h-2 text-neutral-300" fill="none" viewBox="0 0 8 8" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" d="M1 1l6 6M7 1L1 7" />
        </svg>
      </button>
    </div>
  );
}

// ── Windows — rectangular buttons on the right ───────────────────────────────

function WindowsControls({ onHide, onMinimize, onMaximize, maximized }: ControlProps) {
  return (
    <div className="flex items-center" onMouseDown={nodrag}>
      <button onClick={onMinimize} onMouseDown={nodrag}
        className="w-8 h-7 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
        title="Minimize"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 12 2" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" d="M0 1h12" />
        </svg>
      </button>
      <button onClick={onMaximize} onMouseDown={nodrag}
        className="w-8 h-7 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
        title={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={1.5}>
            <rect x="3" y="1" width="8" height="8" rx="0.5" />
            <path strokeLinecap="round" d="M1 4v6.5a.5.5 0 00.5.5H8" />
          </svg>
        ) : (
          <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={1.5}>
            <rect x="1" y="1" width="10" height="10" rx="0.5" />
          </svg>
        )}
      </button>
      <button onClick={onHide} onMouseDown={nodrag}
        className="w-8 h-7 flex items-center justify-center text-neutral-400 hover:text-white hover:bg-red-500 transition-colors"
        title="Hide"
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" d="M1 1l10 10M11 1L1 11" />
        </svg>
      </button>
    </div>
  );
}
