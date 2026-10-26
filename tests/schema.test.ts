import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client, Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runs supabase/schema.sql against a real Postgres and exercises the rules the
 * game depends on: only the host can change the game, only the server decides
 * who buzzed first, and scores are computed from the round rather than from
 * anything a client sends.
 *
 * Point it at any Postgres 14+ with pgcrypto available:
 *
 *   CUSP_TEST_DATABASE_URL=postgres://user@host:5432/db pnpm test
 *
 * It is skipped when that variable is absent, so `pnpm test` still runs
 * everywhere else.
 */
const DATABASE_URL = process.env.CUSP_TEST_DATABASE_URL;
const maybe = DATABASE_URL ? describe : describe.skip;

maybe("supabase/schema.sql", () => {
  let pool: Pool;

  beforeAll(async () => {
    const sql = await readFile(path.resolve(import.meta.dirname, "..", "supabase", "schema.sql"), "utf8");
    const setup = new Client({ connectionString: DATABASE_URL });
    await setup.connect();
    // Supabase ships these roles; a bare Postgres needs them for the grants.
    await setup.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      end $$;
    `);
    await setup.query("drop schema if exists public cascade; create schema public;");
    await setup.query(sql);
    await setup.end();
    pool = new Pool({ connectionString: DATABASE_URL, max: 12 });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
  });

  const HOST_TOKEN = "host-token-0123456789abcdef";

  async function newRoom(): Promise<{ code: string; roomId: string }> {
    const { rows } = await pool.query(
      "select * from create_room($1, $2::jsonb, true, $3, 8)",
      [HOST_TOKEN, JSON.stringify({ columns: [] }), "test-content"],
    );
    return { code: rows[0].code, roomId: rows[0].room_id };
  }

  async function addPlayer(code: string, name: string, token: string): Promise<string> {
    const { rows } = await pool.query("select * from join_room($1, $2, $3)", [code, name, token]);
    return rows[0].player_id;
  }

  async function openRound(code: string, itemId = "itm_demo_1", points = 600): Promise<string> {
    const { rows } = await pool.query(
      "select open_round($1, $2, 'alpha', 'SAMPLE category', $3, $4, $5::jsonb, false) as id",
      [
        code,
        HOST_TOKEN,
        points,
        itemId,
        JSON.stringify({
          stem: "SAMPLE stem",
          options: [
            { id: "A", text: "SAMPLE A" },
            { id: "B", text: "SAMPLE B" },
            { id: "C", text: "SAMPLE C" },
            { id: "D", text: "SAMPLE D" },
          ],
          categoryName: "SAMPLE category",
          cognitiveLevel: "remember",
          origin: "demo-sample",
        }),
      ],
    );
    return rows[0].id;
  }

  it("issues a readable, unique room code", async () => {
    const a = await newRoom();
    const b = await newRoom();
    expect(a.code).toMatch(/^[ACDEFGHJKMNPQRTUVWXY2346789]{5}$/);
    expect(a.code).not.toBe(b.code);
    // No 0/O/1/I/L, which are the characters people misread off a projector.
    expect(a.code).not.toMatch(/[01OIL]/);
  });

  it("refuses a weak host token", async () => {
    await expect(pool.query("select * from create_room($1)", ["short"])).rejects.toThrow(/WEAK_TOKEN/);
  });

  it("rejects host actions from anyone without the host token", async () => {
    const { code } = await newRoom();
    await expect(
      pool.query("select create_team($1, $2, $3)", [code, "not-the-host-token-xxxxx", "Team A"]),
    ).rejects.toThrow(/NOT_HOST/);
    await expect(
      pool.query("select set_room_status($1, $2, 'playing')", [code, "guessing-token-123456789"]),
    ).rejects.toThrow(/NOT_HOST/);
  });

  it("refuses a question payload that carries the answer key", async () => {
    const { code } = await newRoom();
    await expect(
      pool.query(
        "select open_round($1, $2, 'alpha', 'SAMPLE', 200, 'itm_leak', $3::jsonb, false)",
        [code, HOST_TOKEN, JSON.stringify({ stem: "SAMPLE", options: [], key: "B" })],
      ),
    ).rejects.toThrow(/KEY_IN_QUESTION/);
  });

  it("keeps the answer out of the database until the host reveals it", async () => {
    const { code, roomId } = await newRoom();
    const roundId = await openRound(code);

    const before = await pool.query("select answer, revealed_at from rounds where id = $1", [roundId]);
    expect(before.rows[0].answer).toBeNull();
    expect(before.rows[0].revealed_at).toBeNull();

    // The item id is in a table the anon role has no policy for.
    const privatePolicies = await pool.query(
      "select count(*)::int as n from pg_policies where tablename = 'round_private'",
    );
    expect(privatePolicies.rows[0].n).toBe(0);

    await pool.query("select reveal_round($1, $2, $3, $4::jsonb)", [
      code,
      HOST_TOKEN,
      roundId,
      JSON.stringify({ key: "C", explanation: [{ text: "SAMPLE", cites: [] }] }),
    ]);
    const after = await pool.query("select answer, state from rounds where id = $1", [roundId]);
    expect(after.rows[0].answer.key).toBe("C");
    expect(after.rows[0].state).toBe("revealed");
    expect(roomId).toBeTruthy();
  });

  it("will not play the same item twice in one room", async () => {
    const { code } = await newRoom();
    await openRound(code, "itm_repeat");
    await expect(openRound(code, "itm_repeat")).rejects.toThrow(/ITEM_ALREADY_USED/);
  });

  it("gives exactly one winner when many players buzz at once", async () => {
    const { code } = await newRoom();
    const roundId = await openRound(code);
    const tokens = Array.from({ length: 10 }, (_, i) => `player-token-${i}-abcdefghijklmno`);
    await Promise.all(tokens.map((token, i) => addPlayer(code, `SAMPLE player ${i}`, token)));
    await pool.query("select set_buzzing($1, $2, $3, true)", [code, HOST_TOKEN, roundId]);

    // Ten connections race on the same round.
    const results = await Promise.all(
      tokens.map(async (token) => {
        const { rows } = await pool.query("select * from claim_buzz($1, $2)", [token, roundId]);
        return rows[0].won as boolean;
      }),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const winners = await pool.query("select count(*)::int as n from buzz_winners where round_id = $1", [
      roundId,
    ]);
    expect(winners.rows[0].n).toBe(1);
  });

  it("refuses a buzz when the host has not opened the buzzers", async () => {
    const { code } = await newRoom();
    const roundId = await openRound(code);
    await addPlayer(code, "SAMPLE early", "early-token-abcdefghijklmnop");
    await expect(
      pool.query("select * from claim_buzz($1, $2)", ["early-token-abcdefghijklmnop", roundId]),
    ).rejects.toThrow(/BUZZ_CLOSED/);
  });

  it("starts a clean race when the host reopens the buzzers", async () => {
    const { code } = await newRoom();
    const roundId = await openRound(code);
    const first = "fast-token-abcdefghijklmnopq";
    const second = "slow-token-abcdefghijklmnopq";
    await addPlayer(code, "SAMPLE fast", first);
    await addPlayer(code, "SAMPLE slow", second);

    await pool.query("select set_buzzing($1, $2, $3, true)", [code, HOST_TOKEN, roundId]);
    const race1 = await pool.query("select * from claim_buzz($1, $2)", [first, roundId]);
    expect(race1.rows[0].won).toBe(true);

    // Wrong answer: the host reopens, and the earlier winner no longer holds it.
    await pool.query("select * from judge_round($1, $2, $3, false, true, true)", [
      code,
      HOST_TOKEN,
      roundId,
    ]);
    const reopened = await pool.query("select buzz_epoch, winner_player_id from rounds where id = $1", [
      roundId,
    ]);
    expect(reopened.rows[0].winner_player_id).toBeNull();

    const race2 = await pool.query("select * from claim_buzz($1, $2)", [second, roundId]);
    expect(race2.rows[0].won).toBe(true);
  });

  it("computes the score from the round, not from the client", async () => {
    const { code } = await newRoom();
    const roundId = await openRound(code, "itm_score", 800);
    const token = "scorer-token-abcdefghijklmno";
    const playerId = await addPlayer(code, "SAMPLE scorer", token);
    await pool.query("select set_buzzing($1, $2, $3, true)", [code, HOST_TOKEN, roundId]);
    await pool.query("select * from claim_buzz($1, $2)", [token, roundId]);

    const judged = await pool.query("select * from judge_round($1, $2, $3, true, true, true)", [
      code,
      HOST_TOKEN,
      roundId,
    ]);
    expect(judged.rows[0].delta).toBe(800);

    const player = await pool.query("select score from players where id = $1", [playerId]);
    expect(player.rows[0].score).toBe(800);
  });

  it("subtracts the tile value on a wrong answer and allows a negative score", async () => {
    const { code } = await newRoom();
    const roundId = await openRound(code, "itm_negative", 1000);
    const token = "negative-token-abcdefghijkl";
    const playerId = await addPlayer(code, "SAMPLE negative", token);
    await pool.query("select set_buzzing($1, $2, $3, true)", [code, HOST_TOKEN, roundId]);
    await pool.query("select * from claim_buzz($1, $2)", [token, roundId]);
    await pool.query("select * from judge_round($1, $2, $3, false, true, false)", [
      code,
      HOST_TOKEN,
      roundId,
    ]);
    const player = await pool.query("select score from players where id = $1", [playerId]);
    expect(player.rows[0].score).toBe(-1000);
  });

  it("moves a team's score with its player's", async () => {
    const { code } = await newRoom();
    const { rows: teamRows } = await pool.query("select create_team($1, $2, $3) as id", [
      code,
      HOST_TOKEN,
      "SAMPLE team",
    ]);
    const teamId = teamRows[0].id;
    const token = "teamed-token-abcdefghijklmn";
    const playerId = await addPlayer(code, "SAMPLE teamed", token);
    await pool.query("select assign_player_team($1, $2, $3, $4)", [code, HOST_TOKEN, playerId, teamId]);

    const roundId = await openRound(code, "itm_team", 400);
    await pool.query("select set_buzzing($1, $2, $3, true)", [code, HOST_TOKEN, roundId]);
    await pool.query("select * from claim_buzz($1, $2)", [token, roundId]);
    await pool.query("select * from judge_round($1, $2, $3, true, true, true)", [code, HOST_TOKEN, roundId]);

    const team = await pool.query("select score from teams where id = $1", [teamId]);
    expect(team.rows[0].score).toBe(400);
  });

  it("will not score a round nobody has buzzed on", async () => {
    const { code } = await newRoom();
    const roundId = await openRound(code, "itm_nobuzz");
    await expect(
      pool.query("select * from judge_round($1, $2, $3, true, true, true)", [code, HOST_TOKEN, roundId]),
    ).rejects.toThrow(/NO_BUZZ_WINNER/);
  });

  it("rate-limits a player hammering the buzzer", async () => {
    const { code } = await newRoom();
    const roundId = await openRound(code, "itm_spam");
    const token = "spammer-token-abcdefghijklm";
    await addPlayer(code, "SAMPLE spammer", token);
    await pool.query("select set_buzzing($1, $2, $3, true)", [code, HOST_TOKEN, roundId]);

    let rateLimited = false;
    for (let i = 0; i < 9; i += 1) {
      // Each attempt reopens the race so the insert is not a no-op.
      await pool.query("select set_buzzing($1, $2, $3, true)", [code, HOST_TOKEN, roundId]);
      try {
        await pool.query("select * from claim_buzz($1, $2)", [token, roundId]);
      } catch (error) {
        if (String(error).includes("RATE_LIMITED")) {
          rateLimited = true;
          break;
        }
        throw error;
      }
    }
    expect(rateLimited).toBe(true);
  });

  it("keeps a player's identity and score when they reconnect", async () => {
    const { code } = await newRoom();
    const token = "returning-token-abcdefghijk";
    const playerId = await addPlayer(code, "SAMPLE returning", token);
    await pool.query("select adjust_score($1, $2, $3, null, 300)", [code, HOST_TOKEN, playerId]);

    // Same token, same device coming back: same row, same score.
    const again = await pool.query("select * from join_room($1, $2, $3)", [
      code,
      "SAMPLE returning",
      token,
    ]);
    expect(again.rows[0].player_id).toBe(playerId);
    const score = await pool.query("select score from players where id = $1", [playerId]);
    expect(score.rows[0].score).toBe(300);
  });

  it("refuses a duplicate display name from a different device", async () => {
    const { code } = await newRoom();
    await addPlayer(code, "SAMPLE duplicate", "first-device-token-abcdefgh");
    await expect(
      pool.query("select * from join_room($1, $2, $3)", [
        code,
        "SAMPLE duplicate",
        "second-device-token-abcdefgh",
      ]),
    ).rejects.toThrow(/NAME_TAKEN/);
  });

  it("honours the host's late-join rule", async () => {
    const { code } = await newRoom();
    await pool.query("select set_room_status($1, $2, 'playing')", [code, HOST_TOKEN]);
    await pool.query("select set_late_join($1, $2, false)", [code, HOST_TOKEN]);
    await expect(
      pool.query("select * from join_room($1, $2, $3)", [code, "SAMPLE latecomer", "late-token-abcdefghij"]),
    ).rejects.toThrow(/LATE_JOIN_CLOSED/);

    await pool.query("select set_late_join($1, $2, true)", [code, HOST_TOKEN]);
    const joined = await pool.query("select * from join_room($1, $2, $3)", [
      code,
      "SAMPLE latecomer",
      "late-token-abcdefghij",
    ]);
    expect(joined.rows[0].player_id).toBeTruthy();
  });

  it("refuses a join for a code that does not exist", async () => {
    await expect(
      pool.query("select * from join_room($1, $2, $3)", ["ZZZZZ", "SAMPLE ghost", "ghost-token-abcdefghij"]),
    ).rejects.toThrow(/ROOM_NOT_FOUND/);
  });

  it("locks a wager and settles the final from it", async () => {
    const { code } = await newRoom();
    const winToken = "final-win-token-abcdefghij";
    const loseToken = "final-lose-token-abcdefghij";
    const winner = await addPlayer(code, "SAMPLE winner", winToken);
    const loser = await addPlayer(code, "SAMPLE loser", loseToken);
    await pool.query("select adjust_score($1, $2, $3, null, 2000)", [code, HOST_TOKEN, winner]);
    await pool.query("select adjust_score($1, $2, $3, null, 2000)", [code, HOST_TOKEN, loser]);

    const { rows } = await pool.query(
      "select open_round($1, $2, 'alpha', 'SAMPLE', 1000, 'itm_final', $3::jsonb, true) as id",
      [code, HOST_TOKEN, JSON.stringify({ stem: "SAMPLE final", options: [] })],
    );
    const roundId = rows[0].id;

    await pool.query("select set_wager($1, $2, 1500)", [winToken, roundId]);
    await pool.query("select lock_wager($1, $2)", [winToken, roundId]);
    await pool.query("select set_wager($1, $2, 800)", [loseToken, roundId]);
    await pool.query("select lock_wager($1, $2)", [loseToken, roundId]);

    // A locked wager cannot be moved after the fact.
    await expect(pool.query("select set_wager($1, $2, 0)", [winToken, roundId])).rejects.toThrow(
      /WAGER_LOCKED/,
    );

    const settled = await pool.query("select settle_final($1, $2, $3, $4::uuid[]) as n", [
      code,
      HOST_TOKEN,
      roundId,
      [winner],
    ]);
    expect(settled.rows[0].n).toBe(2);

    const scores = await pool.query("select id, score from players where id = any($1::uuid[])", [
      [winner, loser],
    ]);
    const byId = Object.fromEntries(scores.rows.map((r) => [r.id, r.score]));
    expect(byId[winner]).toBe(3500);
    expect(byId[loser]).toBe(1200);
  });

  it("caps a wager at what the player can put up", async () => {
    const { code } = await newRoom();
    const token = "capped-token-abcdefghijklmn";
    const playerId = await addPlayer(code, "SAMPLE capped", token);
    await pool.query("select adjust_score($1, $2, $3, null, 400)", [code, HOST_TOKEN, playerId]);
    const { rows } = await pool.query(
      "select open_round($1, $2, 'alpha', 'SAMPLE', 1000, 'itm_cap', $3::jsonb, true) as id",
      [code, HOST_TOKEN, JSON.stringify({ stem: "SAMPLE", options: [] })],
    );
    // Below 1000 points, the floor lets a player still wager up to 1000.
    const capped = await pool.query("select set_wager($1, $2, 99999) as amount", [token, rows[0].id]);
    expect(capped.rows[0].amount).toBe(1000);
  });

  it("hides an expired room from every reader and cleans it up", async () => {
    const { code, roomId } = await newRoom();
    await pool.query("update rooms set expires_at = now() - interval '1 minute' where id = $1", [roomId]);
    await expect(
      pool.query("select * from join_room($1, $2, $3)", [code, "SAMPLE late", "expired-token-abcdefghij"]),
    ).rejects.toThrow(/ROOM_NOT_FOUND/);

    const removed = await pool.query("select cleanup_expired_rooms() as n");
    expect(removed.rows[0].n).toBeGreaterThanOrEqual(1);
    const gone = await pool.query("select count(*)::int as n from rooms where id = $1", [roomId]);
    expect(gone.rows[0].n).toBe(0);
  });

  it("leaves no public table writable without a function", async () => {
    const { rows } = await pool.query(`
      select tablename, cmd
      from pg_policies
      where schemaname = 'public' and cmd <> 'SELECT'
    `);
    expect(rows).toEqual([]);
  });

  it("stores tokens only as hashes", async () => {
    const { code } = await newRoom();
    const stored = await pool.query(
      "select rp.host_token_hash from room_private rp join rooms r on r.id = rp.room_id where r.code = $1",
      [code],
    );
    expect(stored.rows[0].host_token_hash).not.toContain(HOST_TOKEN);
    expect(stored.rows[0].host_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

/**
 * Guards the seam between the browser client and the database: every RPC name
 * and argument the client sends must exist in schema.sql with exactly that
 * signature. A rename on either side fails here instead of in a seminar room.
 */
maybe("client / schema contract", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
  }, 30_000);

  afterAll(async () => {
    await client?.end();
  });

  it("calls only functions that exist, with the argument names they declare", async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, "..", "src", "multiplayer", "room.ts"),
      "utf8",
    );

    // rpc<...>("name", { p_arg: ..., ... })
    const calls = [...source.matchAll(/rpc<[^>]*>\(\s*"([a-z_]+)"\s*,\s*\{([^}]*)\}/g)].map(
      (match) => ({
        name: match[1] as string,
        args: [...(match[2] ?? "").matchAll(/\b(p_[a-z_]+)\s*:/g)].map((m) => m[1] as string),
      }),
    );
    expect(calls.length).toBeGreaterThan(10);

    const { rows } = await client.query<{ name: string; args: string[] }>(`
      select p.proname as name,
             coalesce(array_agg(a.arg order by a.ord) filter (where a.arg is not null), '{}') as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join lateral unnest(p.proargnames) with ordinality as a(arg, ord) on true
      where n.nspname = 'public'
      group by p.proname
    `);
    const declared = new Map(rows.map((r) => [r.name, r.args]));

    const problems: string[] = [];
    for (const call of calls) {
      const args = declared.get(call.name);
      if (!args) {
        problems.push(`${call.name}(): no such function in schema.sql`);
        continue;
      }
      for (const arg of call.args) {
        if (!args.includes(arg)) {
          problems.push(`${call.name}(): schema.sql has no argument ${arg}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("reads only tables the anon role is granted", async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, "..", "src", "multiplayer", "room.ts"),
      "utf8",
    );
    const tables = [...new Set([...source.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1] as string))];
    expect(tables.length).toBeGreaterThan(3);

    const { rows } = await client.query<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
      where grantee = 'anon' and privilege_type = 'SELECT' and table_schema = 'public'
    `);
    const granted = new Set(rows.map((r) => r.table_name));
    expect(tables.filter((t) => !granted.has(t))).toEqual([]);
  });

  it("never grants anon a write on a table", async () => {
    const { rows } = await client.query<{ table_name: string; privilege_type: string }>(`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'anon' and table_schema = 'public'
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    `);
    expect(rows).toEqual([]);
  });

  it("keeps the private tables unreadable by anon", async () => {
    const { rows } = await client.query<{ table_name: string }>(`
      select table_name from information_schema.role_table_grants
      where grantee in ('anon', 'authenticated') and table_schema = 'public'
        and table_name in ('room_private', 'player_private', 'round_private')
    `);
    expect(rows).toEqual([]);
  });
});
