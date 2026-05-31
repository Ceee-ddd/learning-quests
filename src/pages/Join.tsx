import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { InfoBox } from "@/components/InfoBox";
import { Users, AlertTriangle, Plus, X, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Phase = "register" | "waiting";
type FormMode = "register" | "reconnect";

export default function Join() {
  const { sessionId } = useParams();
  const nav = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [activeForm, setActiveForm] = useState<FormMode>("register");
  const [groupName, setGroupName] = useState("");
  const [password, setPassword] = useState("");
  const [members, setMembers] = useState<string[]>([""]);
  const [pendingMemberAction, setPendingMemberAction] = useState<{
    type: "add" | "remove";
    index?: number;
  } | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<Phase>("register");
  const [registeredGroupId, setRegisteredGroupId] = useState<string | null>(null);
  const [waitingDots, setWaitingDots] = useState(0);
  const [waitingGroups, setWaitingGroups] = useState<any[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle().then(({ data }) => {
      setSession(data);
      // If session already started before this group registered, go straight to play
      // (handled after registration)
    });
  }, [sessionId]);

  // Animated waiting dots
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(() => setWaitingDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(id);
  }, [phase]);

  // Poll for session started_at
  useEffect(() => {
    if (phase !== "waiting" || !registeredGroupId || !sessionId) return;

    const poll = async () => {
      const [{ data: sessionData }, { data: groupsData }] = await Promise.all([
        supabase.from("sessions").select("started_at").eq("id", sessionId).maybeSingle(),
        supabase.from("groups").select("id, group_name, members").eq("session_id", sessionId),
      ]);
      if (groupsData) setWaitingGroups(groupsData);
      if (sessionData?.started_at) {
        // Record start_time on the group now that the race is on
        await supabase
          .from("groups")
          .update({ start_time: new Date().toISOString() })
          .eq("id", registeredGroupId);
        clearInterval(pollRef.current!);
        nav(`/play/${registeredGroupId}`);
      }
    };

    pollRef.current = setInterval(poll, 2000);
    poll(); // immediate first check

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase, registeredGroupId, sessionId, nav]);

  async function performSubmit() {
    if (!sessionId) return toast.error("Session not found.");

    const { data: latest } = await supabase
      .from("sessions").select("allow_late_registration,is_active,started_at").eq("id", sessionId!).maybeSingle();
    if (latest?.is_active === false) return toast.error("This session is not active.");
    if (activeForm === "register" && latest?.allow_late_registration === false) return toast.error("Registration is now closed.");
    if (!groupName.trim()) return toast.error(activeForm === "register" ? "Please enter a group name" : "Enter your group name.");
    if (!password.trim()) return toast.error("Password is required.");

    const normalizedName = groupName.trim();
    const { data: existingGroups, error: lookupError } = await supabase
      .from("groups")
      .select("id")
      .eq("session_id", sessionId)
      .ilike("group_name", normalizedName)
      .limit(1);

    if (lookupError) return toast.error(lookupError.message);
    if (activeForm === "register" && existingGroups?.length) {
      return toast.error("A group with that name already exists in this session. Choose a different name.");
    }

    setSubmitting(true);
    try {
      if (activeForm === "register") {
        const cleanMembers = members.map((m) => m.trim()).filter(Boolean);
        if (cleanMembers.length === 0) return toast.error("Add at least one member");

        const { data, error } = await supabase
          .from("groups")
          .insert({
            session_id: sessionId,
            group_name: normalizedName,
            members: cleanMembers,
            password: password.trim(),
          })
          .select()
          .single();
        if (error) return toast.error(error.message);

        toast.success("Group registered!");

        if (latest?.started_at) {
          await supabase.from("groups").update({ start_time: new Date().toISOString() }).eq("id", data.id);
          nav(`/play/${data.id}`);
        } else {
          setRegisteredGroupId(data.id);
          setPhase("waiting");
        }
      } else {
        const { data: group, error } = await supabase
          .from("groups")
          .select("id, start_time")
          .eq("session_id", sessionId)
          .eq("group_name", groupName.trim())
          .eq("password", password.trim())
          .maybeSingle();
        if (error) return toast.error(error.message);
        if (!group) return toast.error("Group name or password not found. Check and try again.");

        if (latest?.started_at || group.start_time) {
          if (!group.start_time && latest?.started_at) {
            await supabase.from("groups").update({ start_time: new Date().toISOString() }).eq("id", group.id);
          }
          nav(`/play/${group.id}`);
        } else {
          toast.success("Group found. Reconnected and waiting for teacher to start.");
          setRegisteredGroupId(group.id);
          setPhase("waiting");
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setShowSubmitConfirm(true);
  }

  async function confirmSubmit() {
    setShowSubmitConfirm(false);
    await performSubmit();
  }

  if (!session) {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="px-4">
          <div className="app-card text-center text-muted-foreground">Session not found.</div>
        </div>
      </div>
    );
  }

  // ── Waiting Lobby ──
  if (phase === "waiting") {
    return (
      <div className="app-shell pb-12">
        <AppHeader />
        <div className="px-4 flex flex-col items-center justify-center min-h-[70vh] space-y-6">
          <div className="app-card w-full text-center space-y-6 animate-pop-in py-10">

            {/* Animated spinner ring */}
            <div className="relative mx-auto w-20 h-20">
              <div className="absolute inset-0 rounded-full border-4 border-muted" />
              <div className="absolute inset-0 rounded-full border-4 border-action border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Clock className="w-8 h-8 text-action" />
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-xl font-bold text-primary">
                Waiting for Teacher{".".repeat(waitingDots)}
              </h2>
              <p className="text-sm text-muted-foreground">
                Your group <span className="font-semibold text-foreground">{groupName}</span> is registered.
              </p>
              <p className="text-sm text-muted-foreground">
                The quest will begin for everyone at the same time once your teacher starts the session.
              </p>
            </div>

            {/* Pulsing "Ready" badge */}
            <div className="inline-flex items-center gap-2 rounded-full bg-success/10 border border-success/30 px-4 py-2">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-sm font-semibold text-success">Ready to go</span>
            </div>

            <p className="text-xs text-muted-foreground">
              Keep this screen open — you'll be taken to the quest automatically.
            </p>
          </div>

          {/* Registered groups list */}
          {waitingGroups.length > 0 && (
            <div className="w-full space-y-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold text-primary">
                  {waitingGroups.length} Group{waitingGroups.length !== 1 ? "s" : ""} Registered
                </span>
              </div>
              {waitingGroups.map((g) => {
                const isMe = g.id === registeredGroupId;
                const memberList: string[] = g.members || [];
                return (
                  <div
                    key={g.id}
                    className={`rounded-xl border px-3 py-2.5 space-y-1.5 transition ${
                      isMe
                        ? "border-action bg-action/8"
                        : "border-border bg-background/50"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isMe && <span className="w-2 h-2 rounded-full bg-action flex-shrink-0 animate-pulse" />}
                      <span className={`text-sm font-semibold ${isMe ? "text-action" : "text-foreground"}`}>
                        {g.group_name}{isMe ? " (you)" : ""}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {memberList.length} member{memberList.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {memberList.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {memberList.map((name, i) => (
                          <span
                            key={i}
                            className="text-[10px] bg-muted border border-border rounded-full px-2 py-0.5 text-foreground/70"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Registration ──
  return (
    <div className="app-shell pb-12">
      <AppHeader />
      <div className="px-4 space-y-4">
        <div className="app-card space-y-3">
          <h2 className="text-lg font-bold text-primary">
            The Last Message of Room 407 – Group Registration
          </h2>
          <p className="text-sm text-muted-foreground">
            Register your group before you begin the escape-room style reading activity.
            One member should fill this in for the whole group.
          </p>
          <p className="text-sm text-foreground/80">
            You'll work through five physical compartments. After each puzzle, scan the QR code
            inside the compartment to unlock the next challenge on this device.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <InfoBox
            icon={Users}
            label="Register new group"
            onClick={() => { setActiveForm("register"); setOpen(true); }}
          >
            Register your group and set a required group password.
          </InfoBox>
          <InfoBox
            icon={Users}
            label="Reconnect session"
            onClick={() => { setActiveForm("reconnect"); setOpen(true); }}
          >
            Reconnect using your group name and password if you lost the join link.
          </InfoBox>
        </div>

        {open && (
          <form onSubmit={submit} className="app-card space-y-3 animate-pop-in">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveForm("register")}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  activeForm === "register" ? "bg-action text-white" : "border border-border bg-background text-muted-foreground"
                }`}
              >
                Register
              </button>
              <button
                type="button"
                onClick={() => setActiveForm("reconnect")}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  activeForm === "reconnect" ? "bg-action text-white" : "border border-border bg-background text-muted-foreground"
                }`}
              >
                Reconnect
              </button>
            </div>

            <label className="block">
              <span className="text-sm font-semibold text-primary">Group Name</span>
              <input className="field-input mt-1" value={groupName} onChange={(e) => setGroupName(e.target.value)} maxLength={60} />
            </label>

            <label className="block">
              <span className="text-sm font-semibold text-primary">Group Password <span className="text-destructive">(required)</span></span>
              <input
                type="password"
                className="field-input mt-1"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Required password for reconnecting"
                maxLength={32}
              />
              <p className="text-xs text-muted-foreground mt-1">
                This password is required and visible to the teacher along with your group name and members.
              </p>
            </label>

            {activeForm === "register" && (
              <div className="space-y-2">
                <span className="text-sm font-semibold text-primary">Members</span>
                {members.map((m, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input
                      className="field-input flex-1 min-w-[160px]"
                      placeholder={`Member ${i + 1}`}
                      value={m}
                      maxLength={60}
                      onChange={(e) => setMembers(members.map((mm, j) => (i === j ? e.target.value : mm)))}
                    />
                    {members.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setPendingMemberAction({ type: "remove", index: i })}
                        className="rounded-xl border border-destructive px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/10 transition"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {members.length < 6 && (
                  <button
                    type="button"
                    onClick={() => setPendingMemberAction({ type: "add" })}
                    className="text-sm text-action font-semibold flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Add member
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              disabled={submitting}
              onClick={() => setShowSubmitConfirm(true)}
              className="btn-primary"
            >
              {submitting
                ? activeForm === "register"
                  ? "Registering..."
                  : "Reconnecting..."
                : activeForm === "register"
                ? "Register Group"
                : "Reconnect"}
            </button>
          </form>
        )}

        <InfoBox icon={AlertTriangle} label="Only registered groups can continue to the activity." tone="warning">
          Make sure your group is registered above before you head to Compartment 1.
        </InfoBox>

        {showSubmitConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowSubmitConfirm(false); }}
          >
            <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 text-action">
                  <Users className="w-5 h-5 flex-shrink-0" />
                  <h2 className="text-lg font-bold">
                    {activeForm === "register" ? "Confirm Registration" : "Confirm Reconnect"}
                  </h2>
                </div>
                <button onClick={() => setShowSubmitConfirm(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {activeForm === "register"
                  ? "Are you ready to register your group? Once confirmed, your group name, password, and members will be saved and visible to the teacher."
                  : "Confirm reconnect by group name and password. Your teacher can see the password for support if needed."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSubmitConfirm(false)}
                  className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmSubmit}
                  disabled={submitting}
                  className="flex-1 rounded-xl py-2 text-sm font-semibold text-white transition bg-action hover:opacity-90 disabled:opacity-50"
                >
                  {activeForm === "register" ? "Register now" : "Reconnect now"}
                </button>
              </div>
            </div>
          </div>
        )}

        {pendingMemberAction && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
            onClick={(e) => { if (e.target === e.currentTarget) setPendingMemberAction(null); }}
          >
            <div className="bg-background rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4 animate-pop-in">
              <div className="flex items-start justify-between gap-2">
                <div className={`flex items-center gap-2 ${pendingMemberAction.type === "remove" ? "text-destructive" : "text-action"}`}>
                  {pendingMemberAction.type === "remove" ? (
                    <Trash2 className="w-5 h-5 flex-shrink-0" />
                  ) : (
                    <Plus className="w-5 h-5 flex-shrink-0" />
                  )}
                  <h2 className="text-lg font-bold">
                    {pendingMemberAction.type === "remove" ? "Remove Member" : "Add Member"}
                  </h2>
                </div>
                <button onClick={() => setPendingMemberAction(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {pendingMemberAction.type === "remove"
                  ? `Remove member ${pendingMemberAction.index !== undefined ? pendingMemberAction.index + 1 : ""}? This will delete that member field.`
                  : "Add a new member field for your group. Confirm to proceed."}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPendingMemberAction(null)}
                  className="flex-1 rounded-xl border-2 border-border py-2 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (pendingMemberAction?.type === "add") {
                      setMembers((prev) => [...prev, ""]);
                    } else if (pendingMemberAction?.type === "remove" && pendingMemberAction.index !== undefined) {
                      setMembers((prev) => prev.filter((_, idx) => idx !== pendingMemberAction.index));
                    }
                    setPendingMemberAction(null);
                  }}
                  className={`flex-1 rounded-xl py-2 text-sm font-semibold text-white transition ${pendingMemberAction.type === "remove" ? "bg-destructive hover:opacity-90" : "bg-action hover:opacity-90"}`}
                >
                  {pendingMemberAction.type === "remove" ? "Remove Member" : "Add Member"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}