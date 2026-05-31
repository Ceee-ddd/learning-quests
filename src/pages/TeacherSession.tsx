import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AppHeader } from "@/components/AppHeader";
import { ArrowLeft, Save, ChevronDown, ChevronUp, Download, Plus, Trash2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";

// Inject print styles once
const PRINT_STYLE_ID = "teacher-session-print-styles";
function injectPrintStyles() {
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body > *:not(#qr-print-area) { display: none !important; }
      #qr-print-area { display: flex !important; }
    }
    #qr-print-area {
      display: none;
      flex-wrap: wrap;
      gap: 32px;
      padding: 24px;
      font-family: sans-serif;
    }
    #qr-print-area .print-qr-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      page-break-inside: avoid;
      break-inside: avoid;
      width: 180px;
    }
    #qr-print-area .print-qr-item .print-label {
      font-size: 14px;
      font-weight: 700;
      text-align: center;
      color: #111;
    }
    #qr-print-area .print-qr-item .print-sublabel {
      font-size: 11px;
      color: #555;
      text-align: center;
    }
    #qr-print-area .print-qr-item canvas {
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 6px;
      background: white;
    }
  `;
  document.head.appendChild(style);
}

// Subtle fade-in for page transitions (no bounce)
const FADE_STYLE = `
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(4px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in { animation: fade-in 0.18s ease-out both; }
`;

// Default challenge template for new compartments
function defaultChallenge(sessionId: string, level: number) {
  return {
    session_id: sessionId,
    level,
    type: "sequence",
    story_text: null,
    question_text: "",
    correct_answer_code: "",
    compartment_code: "",
    reveal_message: "",
    keywords: [],
    options: [],
  };
}

export default function TeacherSession() {
  const { sessionId } = useParams();
  const { user, loading } = useAuth();
  const [session, setSession] = useState<any>(null);
  const [challenges, setChallenges] = useState<any[]>([]);
  const [joinQrExpanded, setJoinQrExpanded] = useState(true);
  const [activePage, setActivePage] = useState(0); // index into challenges array
  const [saving, setSaving] = useState(false);
  const [addingCompartment, setAddingCompartment] = useState(false);
  const [removingCompartment, setRemovingCompartment] = useState(false);
  const [showAddConfirm, setShowAddConfirm] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<any>(null);
  const [dirtyPages, setDirtyPages] = useState<Set<string>>(new Set());

  useEffect(() => { injectPrintStyles(); }, []);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
      setSession(s);
      const { data: c } = await supabase
        .from("challenges").select("*").eq("session_id", sessionId).order("level");
      setChallenges(c || []);
    })();
  }, [sessionId]);

  // Keep activePage in bounds if challenges shrink
  useEffect(() => {
    if (activePage >= challenges.length && challenges.length > 0) {
      setActivePage(challenges.length - 1);
    }
  }, [challenges.length]);

  function markDirty(id: string) {
    setDirtyPages((prev) => new Set(prev).add(id));
  }

  function updateChallenge(id: string, patch: Record<string, any>) {
    setChallenges((arr) => arr.map((x) => x.id === id ? { ...x, ...patch } : x));
    markDirty(id);
  }

  async function saveChallenge(c: any) {
    setSaving(true);
    const { error } = await supabase.from("challenges").update({
      story_text: c.story_text,
      question_text: c.question_text,
      correct_answer_code: c.correct_answer_code,
      compartment_code: c.compartment_code,
      reveal_message: c.reveal_message,
      keywords: c.keywords,
      options: c.options,
      type: c.type,
    }).eq("id", c.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Compartment ${c.level} saved`);
      setDirtyPages((prev) => { const n = new Set(prev); n.delete(c.id); return n; });
    }
  }

  // If a non-last compartment has type "final_riddle", reset it to "sequence"
  useEffect(() => {
    if (challenges.length < 2) return;
    const nonLast = challenges.slice(0, -1);
    nonLast.forEach((c) => {
      if (c.type === "final_riddle") {
        updateChallenge(c.id, { type: "sequence" });
        toast.info(`Compartment ${c.level} type reset to Sequence — Final Riddle is only allowed on the last compartment.`);
      }
    });
  }, [challenges.length]);

  async function addCompartment() {
    if (!sessionId) return;
    setAddingCompartment(true);
    const nextLevel = challenges.length > 0 ? Math.max(...challenges.map((c) => c.level)) + 1 : 1;
    const template = defaultChallenge(sessionId, nextLevel);
    const { data, error } = await supabase.from("challenges").insert(template).select().single();
    setAddingCompartment(false);
    if (error) {
      if (error.message?.includes("challenges_level_check")) {
        toast.error("Your database limits the number of compartments. Run this in Supabase SQL Editor to unlock more: ALTER TABLE challenges DROP CONSTRAINT challenges_level_check;");
      } else {
        toast.error(error.message);
      }
      return;
    }
    setChallenges((prev) => {
      setActivePage(prev.length); // use up-to-date length, not stale closure
      return [...prev, data];
    });
    toast.success(`Compartment ${nextLevel} added`);
  }

  // Trigger removal confirmation modal
  function removeCompartment(c: any) {
    if (challenges.length <= 1) { toast.error("You need at least one compartment."); return; }
    setRemoveTarget(c);
    setShowRemoveConfirm(true);
  }

  // Perform removal after confirmation
  async function confirmRemoveCompartment() {
    const c = removeTarget;
    if (!c) return;
    setShowRemoveConfirm(false);
    setRemovingCompartment(true);
    const { error } = await supabase.from("challenges").delete().eq("id", c.id);
    if (error) { setRemovingCompartment(false); toast.error(error.message); return; }
    // Re-number sequentially one-by-one to avoid transient unique constraint violations.
    const remaining = challenges.filter((x) => x.id !== c.id);
    const renumbered = remaining.map((x, i) => ({ ...x, level: i + 1 }));
    for (const x of renumbered) {
      await supabase.from("challenges").update({ level: x.level }).eq("id", x.id);
    }
    setRemovingCompartment(false);
    setChallenges(renumbered);
    setDirtyPages((prev) => { const n = new Set(prev); n.delete(c.id); return n; });
    toast.success(`Compartment ${c.level} removed`);
    setRemoveTarget(null);
  }

  function downloadQr(canvasId: string, filename: string) {
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  if (loading) return <div className="app-shell"><AppHeader /></div>;

  // Inject subtle page-transition keyframe once
  if (typeof document !== "undefined" && !document.getElementById("fade-in-style")) {
    const s = document.createElement("style");
    s.id = "fade-in-style";
    s.textContent = FADE_STYLE;
    document.head.appendChild(s);
  }
  if (!user) return (
    <div className="app-shell">
      <AppHeader />
      <div className="px-4"><Link to="/teacher/login" className="btn-primary inline-block">Sign in</Link></div>
    </div>
  );
  if (!session) return <div className="app-shell"><AppHeader /><div className="px-4 text-center">Loading...</div></div>;

  const joinUrl = `${window.location.origin}/join/${session.id}`;
  const activeChallenge = challenges[activePage] ?? null;
  const totalCompartments = challenges.length;
  // Compartments that get a QR (all except the last, since last has no "next" to unlock)
  const unlockLevels = challenges.slice(0, -1).map((c) => c.level);

  return (
    <div className="app-shell pb-16">
      <AppHeader subtitle={`Session ${session.join_code}`} />
      <div className="px-4 space-y-4">
        <Link to="/teacher/dashboard" className="text-sm text-action font-semibold flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </Link>

        {/* ── Student Join QR ── */}
        <div className="app-card space-y-3">
          <button
            onClick={() => setJoinQrExpanded((v) => !v)}
            className="w-full flex items-center justify-between"
          >
            <div className="text-left">
              <div className="font-bold text-primary text-base">Student Join QR</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Display or print this — students scan to register
              </div>
            </div>
            {joinQrExpanded
              ? <ChevronUp className="w-5 h-5 text-muted-foreground" />
              : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
          </button>

          {joinQrExpanded && (
            <div className="space-y-3 animate-pop-in">
              <div className="flex items-center gap-4 bg-muted/40 rounded-2xl p-4">
                <div className="bg-white p-2 rounded-xl shadow">
                  <QRCodeCanvas id="join-qr-canvas" value={joinUrl} size={140} includeMargin />
                </div>
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Session code</div>
                    <div className="text-3xl font-bold tracking-[0.15em] text-primary mt-0.5">{session.join_code}</div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Students can scan the QR <em>or</em> tap "I'm a Student" and type this code.
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => downloadQr("join-qr-canvas", `join-qr-${session.join_code}.png`)}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
                >
                  <Download className="w-4 h-4" /> Download QR
                </button>
                <button
                  onClick={() => window.print()}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-border py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
                >
                  🖨️ Print
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Compartment Unlock QRs ── */}
        <div className="app-card space-y-3">
          <div className="font-bold text-primary">Compartment Unlock QRs</div>
          <p className="text-xs text-muted-foreground">
            Print and place inside each physical compartment. After a group solves Compartment N,
            they scan its QR to unlock the next level.
          </p>
          {unlockLevels.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Add at least 2 compartments to generate unlock QRs.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {unlockLevels.map((n) => {
                const canvasId = `unlock-qr-${n}`;
                return (
                  <div key={n} className="bg-background rounded-xl p-3 text-center space-y-1.5 border border-border">
                    <div className="text-xs font-semibold text-primary">Compartment {n}</div>
                    <div className="bg-white p-1.5 rounded-lg inline-block">
                      <QRCodeCanvas id={canvasId} value={`?from=${n}`} size={88} includeMargin />
                    </div>
                    <button
                      onClick={() => downloadQr(canvasId, `compartment-${n}-unlock.png`)}
                      className="text-[10px] text-action font-semibold flex items-center justify-center gap-1 mx-auto"
                    >
                      <Download className="w-3 h-3" /> Save
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Tip: For per-group QR codes, use each group's{" "}
            <code>/play/&lt;id&gt;/scan?from=N</code> URL.
          </p>
        </div>

        {/* ── Challenge Builder — Paginated ── */}
        <div className="app-card space-y-0 overflow-hidden p-0">

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
            <div>
              <div className="font-bold text-primary">Challenge Builder</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {totalCompartments} compartment{totalCompartments !== 1 ? "s" : ""} configured
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Remove button (opens confirm modal) */}
              <button
                onClick={() => activeChallenge && removeCompartment(activeChallenge)}
                disabled={removingCompartment || totalCompartments <= 1}
                title="Remove this compartment"
                className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-destructive/40 text-destructive hover:bg-destructive/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {/* Add button (opens confirm modal) */}
              <button
                onClick={() => setShowAddConfirm(true)}
                disabled={addingCompartment}
                title="Add compartment"
                className="w-8 h-8 flex items-center justify-center rounded-lg border-2 border-action/50 text-action hover:bg-action/10 transition disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Pagination tab strip */}
          {challenges.length > 0 && (
            <div className="flex items-center gap-1 px-3 pt-3 pb-2 overflow-x-auto">
              <button
                onClick={() => setActivePage((p) => Math.max(0, p - 1))}
                disabled={activePage === 0}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {challenges.map((c, i) => {
                const isDirty = dirtyPages.has(c.id);
                const isActive = i === activePage;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActivePage(i)}
                    className={`relative shrink-0 h-8 min-w-[2.5rem] px-3 rounded-lg text-xs font-bold transition-all duration-200 ${
                      isActive
                        ? "bg-action text-white shadow-sm scale-105"
                        : "bg-muted/60 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {c.level}
                    {isDirty && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400 border border-background" />
                    )}
                  </button>
                );
              })}

              <button
                onClick={() => setActivePage((p) => Math.min(challenges.length - 1, p + 1))}
                disabled={activePage === challenges.length - 1}
                className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Active compartment form — only this part changes */}
          {activeChallenge ? (
            <div key={activeChallenge.id} className="px-4 pb-4 pt-2 space-y-3 animate-fade-in">

              {/* Compartment label + type selector */}
              <div className="flex items-center justify-between">
                <div className="text-sm font-bold text-primary">
                  Compartment {activeChallenge.level}
                </div>
                <select
                  className="text-xs rounded-lg border border-border bg-background px-2 py-1.5 text-foreground focus:outline-none focus:border-action transition"
                  value={activeChallenge.type}
                  onChange={(e) => updateChallenge(activeChallenge.id, { type: e.target.value })}
                >
                  <option value="sequence">Sequence (code)</option>
                  <option value="multiple_choice">Multiple Choice</option>
                  <option value="short_answer">Short Answer</option>
                  <option value="long_text">Long Text</option>
                  {activePage === challenges.length - 1 && (
                    <option value="final_riddle">Final Riddle</option>
                  )}
                </select>
              </div>

              {/* Story text — only for level 1 */}
              {activeChallenge.level === 1 && (
                <label className="block text-xs">
                  <span className="font-semibold text-primary">Story Text</span>
                  <textarea
                    className="field-input mt-1 min-h-[160px] sm:min-h-[200px] md:min-h-[240px] text-sm"
                    value={activeChallenge.story_text || ""}
                    onChange={(e) => updateChallenge(activeChallenge.id, { story_text: e.target.value })}
                  />
                </label>
              )}

              <label className="block text-xs">
                <span className="font-semibold text-primary">Question / Prompt</span>
                <textarea
                  className="field-input mt-1 min-h-[140px] sm:min-h-[160px] md:min-h-[200px] text-sm"
                  value={activeChallenge.question_text || ""}
                  onChange={(e) => updateChallenge(activeChallenge.id, { question_text: e.target.value })}
                />
              </label>

              {(activeChallenge.type === "sequence" || activeChallenge.type === "final_riddle") && (
                <label className="block text-xs">
                  <span className="font-semibold text-primary">Correct Answer Code</span>
                  <input
                    className="field-input mt-1 text-sm py-4 sm:py-3"
                    value={activeChallenge.correct_answer_code || ""}
                    onChange={(e) => updateChallenge(activeChallenge.id, { correct_answer_code: e.target.value })}
                  />
                </label>
              )}

              {(activeChallenge.type === "short_answer" || activeChallenge.type === "long_text") && (
                <label className="block text-xs">
                  <span className="font-semibold text-primary">Keywords (comma-separated)</span>
                  <input
                    className="field-input mt-1 text-sm py-4 sm:py-3"
                    value={(activeChallenge.keywords || []).join(", ")}
                    onChange={(e) =>
                      updateChallenge(activeChallenge.id, {
                        keywords: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean),
                      })
                    }
                  />
                </label>
              )}

              <label className="block text-xs">
                <span className="font-semibold text-primary">Compartment / Padlock Code</span>
                <input
                  className="field-input mt-1 text-sm py-4 sm:py-3"
                  value={activeChallenge.compartment_code || ""}
                  onChange={(e) => updateChallenge(activeChallenge.id, { compartment_code: e.target.value })}
                />
              </label>

              <label className="block text-xs">
                <span className="font-semibold text-primary">Reveal Message</span>
                <textarea
                  className="field-input mt-1 min-h-[120px] sm:min-h-[140px] text-sm"
                  value={activeChallenge.reveal_message || ""}
                  onChange={(e) => updateChallenge(activeChallenge.id, { reveal_message: e.target.value })}
                />
              </label>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => saveChallenge(activeChallenge)}
                  disabled={saving}
                  className="flex-1 btn-primary flex items-center justify-center gap-2 text-sm"
                >
                  <Save className="w-4 h-4" />
                  {saving ? "Saving…" : dirtyPages.has(activeChallenge.id) ? "Save Changes" : "Saved"}
                </button>
                {/* Quick prev/next nav */}
                <button
                  onClick={() => setActivePage((p) => Math.max(0, p - 1))}
                  disabled={activePage === 0}
                  className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setActivePage((p) => Math.min(challenges.length - 1, p + 1))}
                  disabled={activePage === challenges.length - 1}
                  className="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-border text-muted-foreground hover:bg-muted disabled:opacity-30 transition"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              {/* Page indicator */}
              <div className="flex justify-center gap-1.5 pt-1">
                {challenges.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePage(i)}
                    className={`transition-all duration-200 rounded-full ${
                      i === activePage
                        ? "w-5 h-1.5 bg-action"
                        : "w-1.5 h-1.5 bg-muted-foreground/30 hover:bg-muted-foreground/60"
                    }`}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="px-4 pb-6 pt-4 text-center text-muted-foreground text-sm">
              No compartments yet.{" "}
              <button onClick={() => setShowAddConfirm(true)} className="text-action font-semibold underline">Add one</button>.
            </div>
          )}
        </div>
      </div>

      {/* Add Compartment Confirmation Modal */}
      {showAddConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddConfirm(false); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-action">
                <Plus className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">Add Compartment</h2>
              </div>
              <button onClick={() => setShowAddConfirm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This will add a new compartment to the session and assign it the next sequential level. Continue?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddConfirm(false)}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={async () => { setShowAddConfirm(false); await addCompartment(); }}
                disabled={addingCompartment}
                className="flex-1 rounded-xl bg-action py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
              >
                {addingCompartment ? "Adding…" : "Add Compartment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Compartment Confirmation Modal */}
      {showRemoveConfirm && removeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={(e) => { if (e.target === e.currentTarget) setShowRemoveConfirm(false); }}
        >
          <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-destructive">
                <Trash2 className="w-5 h-5 flex-shrink-0" />
                <h2 className="text-lg font-bold">Delete Compartment</h2>
              </div>
              <button onClick={() => setShowRemoveConfirm(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This will permanently delete Compartment <span className="font-bold text-primary">{removeTarget.level}</span> and its content. This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowRemoveConfirm(false); setRemoveTarget(null); }}
                className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
              >
                Cancel
              </button>
              <button
                onClick={confirmRemoveCompartment}
                disabled={removingCompartment}
                className="flex-1 rounded-xl bg-destructive py-2 text-sm font-semibold text-white hover:opacity-90 transition disabled:opacity-40"
              >
                {removingCompartment ? "Deleting…" : "Delete Compartment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Hidden QR Print Area ── */}
      {createPortal(
        <div id="qr-print-area">
          <div className="print-qr-item">
            <div className="print-label">Session Code</div>
            <div className="print-sublabel">{session.join_code}</div>
            <QRCodeCanvas id="print-join-qr" value={joinUrl} size={160} includeMargin />
            <div className="print-sublabel">Scan to join the session</div>
          </div>
          {unlockLevels.map((n) => (
            <div key={n} className="print-qr-item">
              <div className="print-label">Compartment {n}</div>
              <div className="print-sublabel">Place inside compartment {n}</div>
              <QRCodeCanvas
                id={`print-unlock-qr-${n}`}
                value={`${window.location.origin}/play/SCAN/scan?from=${n}`}
                size={160}
                includeMargin
              />
              <div className="print-sublabel">Scan to unlock next level</div>
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}