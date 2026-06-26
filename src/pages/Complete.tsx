import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Trophy, Clock, Medal, Home, Star, Zap } from "lucide-react";

interface RankedGroup {
  id: string;
  group_name: string;
  elapsed_ms: number;
  total_points: number;
  rank: number;
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Sum all per-compartment points stored in question_assignments._pts */
function extractPoints(qa: any): number {
  if (!qa || typeof qa !== "object") return 0;
  const pts = qa._pts;
  if (!pts || typeof pts !== "object") return 0;
  return Object.values(pts as Record<string, number>).reduce(
    (sum: number, v) => sum + (typeof v === "number" ? v : 0),
    0
  );
}

export default function Complete() {
  const { groupId } = useParams();
  const nav = useNavigate();
  const [groupName, setGroupName] = useState<string>("");
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myElapsed, setMyElapsed] = useState<number | null>(null);
  const [myPoints, setMyPoints] = useState<number>(0);
  const [leaderboard, setLeaderboard] = useState<RankedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [myStartTime, setMyStartTime] = useState<string | null>(null);
  const [myFinishTime, setMyFinishTime] = useState<string | null>(null);
  const [hasPointsData, setHasPointsData] = useState(false);

  async function loadLeaderboard(sid: string, gid: string, startTime: string, finishTime: string) {
    const { data: allGroups } = await supabase
      .from("groups")
      .select("id, group_name, start_time, finish_time, question_assignments")
      .eq("session_id", sid)
      .not("finish_time", "is", null)
      .not("start_time", "is", null);

    if (allGroups && allGroups.length > 0) {
      const anyHasPoints = allGroups.some((g) => extractPoints(g.question_assignments) > 0);
      setHasPointsData(anyHasPoints);

      const ranked: RankedGroup[] = allGroups
        .map((g) => ({
          id: g.id,
          group_name: g.group_name,
          elapsed_ms: new Date(g.finish_time).getTime() - new Date(g.start_time).getTime(),
          total_points: extractPoints(g.question_assignments),
        }))
        .filter((g) => g.elapsed_ms > 0)
        // Sort by points desc, then time asc as tiebreaker
        .sort((a, b) => {
          if (anyHasPoints) {
            if (b.total_points !== a.total_points) return b.total_points - a.total_points;
          }
          return a.elapsed_ms - b.elapsed_ms;
        })
        .map((g, i) => ({ ...g, rank: i + 1 }));

      setLeaderboard(ranked);

      const mine = ranked.find((g) => g.id === gid);
      if (mine) {
        setMyRank(mine.rank);
        setMyElapsed(mine.elapsed_ms);
        setMyPoints(mine.total_points);
      } else if (startTime && finishTime) {
        setMyElapsed(new Date(finishTime).getTime() - new Date(startTime).getTime());
      }
    }
  }

  useEffect(() => {
    if (!groupId) return;
    (async () => {
      // 1. Load this group
      const { data: group } = await supabase
        .from("groups")
        .select("group_name, finish_time, start_time, session_id, question_assignments")
        .eq("id", groupId)
        .maybeSingle();

      if (!group) { setLoading(false); return; }

      setGroupName(group.group_name);
      setSessionId(group.session_id);

      // Extract points from persisted data
      const pts = extractPoints(group.question_assignments);
      setMyPoints(pts);
      if (pts > 0) setHasPointsData(true);

      // 2. Record finish_time if not yet set
      let finishTime = group.finish_time;
      if (!finishTime) {
        finishTime = new Date().toISOString();
        await supabase.from("groups").update({ finish_time: finishTime }).eq("id", groupId);
      }

      setMyStartTime(group.start_time);
      setMyFinishTime(finishTime);

      // 3. Initial leaderboard load
      await loadLeaderboard(group.session_id, groupId, group.start_time, finishTime);
      setLoading(false);
    })();
  }, [groupId]);

  // Live subscription — refresh leaderboard whenever any group in this session updates
  useEffect(() => {
    if (!sessionId || !groupId || !myStartTime || !myFinishTime) return;
    const ch = supabase
      .channel(`complete-leaderboard-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "groups", filter: `session_id=eq.${sessionId}` },
        () => loadLeaderboard(sessionId, groupId, myStartTime, myFinishTime)
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [sessionId, groupId, myStartTime, myFinishTime]);

  // Points tier label
  const pointsLabel =
    myPoints >= 30 * 3 ? "Outstanding!" :
    myPoints >= 30 * 2 ? "Excellent!" :
    myPoints > 0 ? "Well done!" : null;

  return (
    <div className="app-shell pb-12">
      <AppHeader />
      <div className="px-4 space-y-4">

        {/* ── Congrats Card ── */}
        <div className="app-card text-center space-y-4 animate-pop-in">
          <div className="mx-auto w-16 h-16 rounded-full bg-success/15 flex items-center justify-center">
            <Trophy className="w-9 h-9 text-success" />
          </div>
          <h2 className="text-2xl font-bold text-primary">Congratulations, Investigators!</h2>
          <p className="text-sm text-muted-foreground">
            You have solved all compartments and completed the activity.
          </p>
          {groupName && (
            <p className="text-base font-semibold text-foreground">Well done, Group {groupName}!</p>
          )}

          {/* ── Stats row: Time · Points · Rank ── */}
          {!loading && myElapsed !== null && (
            <div className="flex justify-center gap-3 pt-1">

              {/* Elapsed time */}
              <div className="flex-1 max-w-[130px] rounded-2xl bg-muted/50 border border-border px-3 py-3 space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide">Your Time</span>
                </div>
                <div className="text-lg font-bold text-primary tabular-nums">
                  {formatElapsed(myElapsed)}
                </div>
              </div>

              {/* Points — only shown when this session used time limits */}
              {hasPointsData && (
                <div className="flex-1 max-w-[130px] rounded-2xl bg-amber-400/10 border border-amber-400/30 px-3 py-3 space-y-1">
                  <div className="flex items-center justify-center gap-1.5 text-amber-600">
                    <Star className="w-3.5 h-3.5 fill-amber-500" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide">Your Score</span>
                  </div>
                  <div className="text-lg font-bold text-amber-600 tabular-nums">
                    {myPoints} pts
                  </div>
                  {pointsLabel && (
                    <div className="text-[10px] font-semibold text-amber-500/80">{pointsLabel}</div>
                  )}
                </div>
              )}

              {/* Rank */}
              {myRank !== null && (
                <div className="flex-1 max-w-[130px] rounded-2xl bg-muted/50 border border-border px-3 py-3 space-y-1">
                  <div className="flex items-center justify-center gap-1.5 text-muted-foreground">
                    <Medal className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide">Your Place</span>
                  </div>
                  <div className={`text-lg font-bold tabular-nums ${
                    myRank === 1 ? "text-yellow-500" :
                    myRank === 2 ? "text-slate-400" :
                    myRank === 3 ? "text-amber-600" :
                    "text-primary"
                  }`}>
                    {ordinal(myRank)}
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Teacher: read the group name above to confirm against your registration list.
          </p>
          <button
            onClick={() => nav("/")}
            className="flex items-center justify-center gap-2 w-full rounded-2xl border-2 border-border py-3 text-sm font-semibold text-muted-foreground hover:bg-muted/50 transition"
          >
            <Home className="w-4 h-4" /> Back to Home
          </button>
        </div>

        {/* ── Leaderboard ── */}
        {!loading && leaderboard.length > 0 && (
          <div className="app-card space-y-3 animate-pop-in">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" />
              <span className="font-bold text-primary">Leaderboard</span>
              <span className="flex items-center gap-1 text-[10px] font-semibold text-success uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                Live
              </span>
              {hasPointsData && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-500 ml-1">
                  <Zap className="w-3 h-3" /> Ranked by score
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {leaderboard.length} group{leaderboard.length !== 1 ? "s" : ""} finished
              </span>
            </div>

            {/* Column headers — only show points column when data exists */}
            <div className={`grid text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-3 ${hasPointsData ? "grid-cols-[auto_1fr_auto_auto]" : "grid-cols-[auto_1fr_auto]"} gap-3`}>
              <span>#</span>
              <span>Group</span>
              {hasPointsData && <span className="text-right text-amber-500">Score</span>}
              <span className="text-right">Time</span>
            </div>

            <div className="space-y-2">
              {leaderboard.map((g) => {
                const isMe = g.id === groupId;
                return (
                  <div
                    key={g.id}
                    className={`grid items-center gap-3 rounded-xl px-3 py-2.5 border transition ${
                      hasPointsData ? "grid-cols-[auto_1fr_auto_auto]" : "grid-cols-[auto_1fr_auto]"
                    } ${
                      isMe
                        ? "border-action bg-action/8 font-semibold"
                        : "border-border bg-background/50"
                    }`}
                  >
                    {/* Rank badge */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      g.rank === 1 ? "bg-yellow-400/20 text-yellow-600" :
                      g.rank === 2 ? "bg-slate-400/20 text-slate-500" :
                      g.rank === 3 ? "bg-amber-400/20 text-amber-600" :
                      "bg-muted text-muted-foreground"
                    }`}>
                      {g.rank <= 3 ? ["🥇","🥈","🥉"][g.rank - 1] : g.rank}
                    </div>

                    <span className={`text-sm truncate ${isMe ? "text-action" : "text-foreground"}`}>
                      {g.group_name}{isMe && " (you)"}
                    </span>

                    {/* Points column */}
                    {hasPointsData && (
                      <span className={`text-sm font-bold tabular-nums text-right ${
                        g.total_points >= 25 ? "text-amber-500" :
                        g.total_points >= 15 ? "text-sky-500" :
                        "text-muted-foreground"
                      }`}>
                        {g.total_points > 0 ? (
                          <span className="flex items-center gap-0.5 justify-end">
                            <Star className="w-3 h-3 fill-current" />
                            {g.total_points}
                          </span>
                        ) : "—"}
                      </span>
                    )}

                    <span className="text-sm tabular-nums text-muted-foreground shrink-0 text-right">
                      {formatElapsed(g.elapsed_ms)}
                    </span>
                  </div>
                );
              })}
            </div>

            {hasPointsData && (
              <p className="text-[10px] text-muted-foreground text-center pt-1">
                Ranked by score · time used as tiebreaker
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}