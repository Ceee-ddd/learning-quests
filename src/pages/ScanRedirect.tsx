import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";

/**
 * ScanRedirect — handles compartment QR codes printed in advance.
 *
 * URL: /session/:sessionId/scan?from=<level>
 *
 * 1. Looks up this device's groupId from localStorage (saved on join).
 * 2. Validates the group belongs to this session.
 * 3. Checks the scanned level == group's current_level (enforces order).
 * 4. Advances current_level in the DB.
 * 5. Redirects to /play/<groupId> (or /complete if last level).
 *
 * If the group isn't found in localStorage, sends them to the join page.
 */

type Status = "loading" | "wrong_level" | "error" | "redirecting";

export default function ScanRedirect() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const fromLevel = parseInt(searchParams.get("from") || "0", 10);
  const [status, setStatus] = useState<Status>("loading");
  const [currentLevel, setCurrentLevel] = useState(0);

  useEffect(() => {
    if (!sessionId || !fromLevel) {
      setStatus("error");
      return;
    }

    async function handle() {
      const storedGroupId = localStorage.getItem(`group_${sessionId}`);

      if (!storedGroupId) {
        // Not joined yet on this device — send to join, preserving the from level
        nav(`/join/${sessionId}?from=${fromLevel}`, { replace: true });
        return;
      }

      // Fetch the group to check current_level and session membership
      const { data: group } = await supabase
        .from("groups")
        .select("id, current_level, session_id, finish_time")
        .eq("id", storedGroupId)
        .eq("session_id", sessionId)
        .maybeSingle();

      if (!group) {
        // Stored ID is stale or wrong session — send to join
        localStorage.removeItem(`group_${sessionId}`);
        nav(`/join/${sessionId}?from=${fromLevel}`, { replace: true });
        return;
      }

      if (group.finish_time) {
        // Already finished — go to complete screen
        nav(`/complete/${storedGroupId}`, { replace: true });
        return;
      }

      const groupCurrentLevel = group.current_level ?? 1;

      // Enforce: student must scan the NEXT compartment's QR (currentLevel + 1)
      // Special case: if currentLevel === 1 and they haven't started (start_time is null),
      // they may be scanning QR 1 to enter the story/challenge — allow from=1 too.
      const expectedFromLevel = groupCurrentLevel + 1;
      const isInitialScan = groupCurrentLevel === 1 && !group.start_time && fromLevel === 1;
      if (fromLevel !== expectedFromLevel && !isInitialScan) {
        setCurrentLevel(groupCurrentLevel);
        setStatus("wrong_level");
        return;
      }

      // Fetch session to check total compartments
      const { data: challenges } = await supabase
        .from("challenges")
        .select("level")
        .eq("session_id", sessionId)
        .order("level");

      const totalLevels = challenges?.length ?? 0;
      const nextLevel = groupCurrentLevel + 1;
      const isLast = nextLevel > totalLevels;

      if (isLast) {
        // Final compartment scanned — mark complete
        const finishTime = new Date().toISOString();
        const updates: any = { finish_time: finishTime };
        if (!group.start_time) updates.start_time = finishTime;
        updates.current_level = totalLevels;
        await supabase.from("groups").update(updates).eq("id", storedGroupId);
        setStatus("redirecting");
        nav(`/complete/${storedGroupId}`, { replace: true });
      } else {
        // Advance to next level
        await supabase.from("groups").update({ current_level: nextLevel }).eq("id", storedGroupId);
        setStatus("redirecting");
        nav(`/play/${storedGroupId}`, { replace: true });
      }
    }

    handle();
  }, [sessionId, fromLevel, nav]);

  if (status === "wrong_level") {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="px-4 mt-8">
          <div className="app-card text-center space-y-3">
            <div className="text-4xl">🔒</div>
            <h2 className="text-lg font-bold text-primary">Wrong Compartment</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This QR is for Compartment {fromLevel}, but you need to scan the QR inside Compartment {currentLevel + 1} to continue.
              Make sure you're opening the right compartment.
            </p>
            <button
              onClick={() => {
                const storedGroupId = localStorage.getItem(`group_${sessionId}`);
                if (storedGroupId) nav(`/play/${storedGroupId}`, { replace: true });
                else nav(`/join/${sessionId}`, { replace: true });
              }}
              className="w-full rounded-2xl border-2 border-border py-3 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
            >
              Back to my challenge
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="app-shell">
        <AppHeader />
        <div className="px-4 text-center text-sm text-muted-foreground mt-8">
          Invalid QR code. Please ask your teacher for help.
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="px-4 text-center text-sm text-muted-foreground mt-8">
        Opening your challenge…
      </div>
    </div>
  );
}