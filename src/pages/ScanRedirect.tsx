import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";

/**
 * ScanRedirect — handles compartment QR codes that are printed in advance.
 *
 * URL: /session/:sessionId/scan?from=<level>
 *
 * The student's device has a stored groupId in localStorage (set when they joined).
 * If found, redirect straight to /play/<groupId>/scan?from=<level>.
 * If not found (e.g. different device), send them to the join page for this session.
 */
export default function ScanRedirect() {
  const { sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const fromLevel = searchParams.get("from");
  const [status, setStatus] = useState<"looking" | "error">("looking");

  useEffect(() => {
    if (!sessionId || !fromLevel) {
      setStatus("error");
      return;
    }

    async function redirect() {
      // Check localStorage for a groupId that belongs to this session
      const storedGroupId = localStorage.getItem(`group_${sessionId}`);

      if (storedGroupId) {
        // Verify it still exists in DB
        const { data: group } = await supabase
          .from("groups")
          .select("id")
          .eq("id", storedGroupId)
          .eq("session_id", sessionId)
          .maybeSingle();

        if (group) {
          nav(`/play/${storedGroupId}/scan?from=${fromLevel}`, { replace: true });
          return;
        }
      }

      // Fallback: send to join page — they'll register and then play
      nav(`/join/${sessionId}?from=${fromLevel}`, { replace: true });
    }

    redirect();
  }, [sessionId, fromLevel, nav]);

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