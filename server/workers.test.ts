import { describe, expect, it } from "vitest";
import { requiredScope } from "./request-auth.ts";
import { turnDestination } from "./turns/turn-route.ts";
import {
  assignBotHost,
  bindWorkerSocket,
  cancelQueued,
  createTurnBell,
  directMachinePlan,
  expireWorkers,
  failPulledOnAuthorCancel,
  channelTurnGate,
  failTurn,
  failTurnOnMembershipRemoval,
  failPulledTurnsOnClose,
  failTurnOnWorkerClose,
  invokeFleetRunner,
  memberIdsChangeDuringHeldTurn,
  parseTurnWrite,
  pullWaitMs,
  selectionOnMachine,
  turnsOpenForMembership,
  pullQueuedForSession,
  queueTurn,
  registerWorker,
  registerWorkerBody,
  takeQueued,
  workersForSession,
} from "./workers.ts";

describe("workers", () => {
  it("does not start a turn for an offline machine", () => {
    const destination = turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: false,
    });
    expect(queueTurn({ destination, messageId: "m1", queued: [] })).toEqual({ queued: ["m1"], started: false });
  });

  it("leaves the queue unchanged for a fleet or online worker destination", () => {
    const queued = ["earlier"];
    const fleet = turnDestination({ host: { kind: "fleet" }, workerOnline: false });
    const worker = turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: true,
    });
    expect(queueTurn({ destination: fleet, messageId: "m2", queued })).toEqual({ queued, started: true });
    expect(queueTurn({ destination: worker, messageId: "m2", queued })).toEqual({ queued, started: true });
    expect(queueTurn({ destination: fleet, messageId: "m2", queued }).queued).toBe(queued);
    expect(queued).toEqual(["earlier"]);
    const calls: string[] = [];
    expect(invokeFleetRunner({ destination: worker, run: () => calls.push("worker") })).toBe(false);
    expect(invokeFleetRunner({ destination: { kind: "queued" }, run: () => calls.push("queued") })).toBe(false);
    expect(invokeFleetRunner({ destination: fleet, run: () => calls.push("fleet") })).toBe(true);
    expect(calls).toEqual(["fleet"]);
  });

  it("replaces the worker with the same deviceId", () => {
    const first = registerWorker([], { deviceId: "laptop", userId: "morgan@example.test", online: true });
    const replaced = registerWorker(first, { deviceId: "laptop", userId: "owner@example.test", online: false });
    expect(replaced).toEqual([{ deviceId: "laptop", userId: "owner@example.test", online: false }]);
    expect(first).toEqual([{ deviceId: "laptop", userId: "morgan@example.test", online: true }]);
    expect(registerWorker(replaced, { deviceId: "studio", userId: "owner@example.test", online: true })).toEqual([
      { deviceId: "laptop", userId: "owner@example.test", online: false },
      { deviceId: "studio", userId: "owner@example.test", online: true },
    ]);
  });

  it("keeps an offline machine queued and does not send it to the fleet", () => {
    expect(channelTurnGate({
      bots: [{ id: "desk", host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" } }],
      workers: [{ deviceId: "laptop", userId: "morgan@example.test", online: false }],
      messageId: "m1",
      queued: [],
    })).toEqual({
      queued: [{ messageId: "m1", deviceId: "laptop", userId: "morgan@example.test", authorId: "", started: false, botId: "desk" }],
      fleetIds: [],
      status: "machine-offline",
    });
  });

  it("starts a fleet bot when no worker is online", () => {
    const queued = [{ messageId: "kept", deviceId: "studio", userId: "p", authorId: "p", started: false }];
    expect(channelTurnGate({
      bots: [{ id: "aurora", host: { kind: "fleet" } }],
      workers: [],
      messageId: "m9",
      queued,
    })).toEqual({ queued, fleetIds: ["aurora"], status: null });
  });

  it("lets an online worker pull its message once and does not call the fleet runner", () => {
    const queued = [{ messageId: "older", deviceId: "studio", userId: "studio-owner", authorId: "p", started: false }];
    const destination = turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: true,
    });
    expect(destination).toEqual({ kind: "worker", deviceId: "laptop" });
    const calls: string[] = [];
    expect(invokeFleetRunner({ destination, run: () => calls.push("fleet") })).toBe(false);
    expect(calls).toEqual([]);
    const gate = channelTurnGate({
      bots: [{ id: "desk", host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" } }],
      workers: [{ deviceId: "laptop", userId: "morgan@example.test", online: true }],
      messageId: "m1",
      authorId: "p_morgan",
      queued,
    });
    expect(gate.fleetIds).toEqual([]);
    expect(gate.status).toBeNull();
    const pulled = takeQueued("laptop", gate.queued, "morgan@example.test");
    expect(pulled.ids).toEqual(["m1"]);
    expect(takeQueued("laptop", pulled.queued, "morgan@example.test").ids).toEqual([]);
    expect(takeQueued("laptop", gate.queued, "ada@example.test").ids).toEqual([]);
    expect(takeQueued("studio", pulled.queued, "studio-owner").ids).toEqual(["older"]);
  });

  it("queues an offline machine until that device pulls it, and does not call the fleet runner", () => {
    const destination = turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: false,
    });
    expect(queueTurn({ destination, messageId: "m1", queued: [] })).toEqual({ queued: ["m1"], started: false });
    const calls: string[] = [];
    expect(invokeFleetRunner({ destination, run: () => calls.push("fleet") })).toBe(false);
    expect(calls).toEqual([]);
    const gate = channelTurnGate({
      bots: [{ id: "desk", host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" } }],
      workers: [],
      messageId: "m1",
      authorId: "p_morgan",
      queued: [],
    });
    expect(gate.fleetIds).toEqual([]);
    expect(gate.status).toBe("machine-offline");
    const pulled = takeQueued("laptop", gate.queued, "morgan@example.test");
    expect(pulled.ids).toEqual(["m1"]);
    expect(pulled.started).toEqual([{ messageId: "m1", deviceId: "laptop", userId: "morgan@example.test", authorId: "p_morgan", started: true, botId: "desk" }]);
    expect(takeQueued("laptop", pulled.queued, "morgan@example.test").ids).toEqual([]);
    expect(takeQueued("studio", gate.queued, "morgan@example.test").ids).toEqual([]);
  });

  it("queues each offline device once and still runs a fleet bot", () => {
    const gate = channelTurnGate({
      bots: [
        { id: "fleet-bot", host: { kind: "fleet" } },
        { id: "desk", host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" } },
        { id: "other", host: { kind: "machine", userId: "ada@example.test", deviceId: "studio" } },
      ],
      workers: [{ deviceId: "laptop", userId: "owner@example.test", online: true }],
      messageId: "m1",
      authorId: "p_morgan",
      queued: [],
    });
    expect(gate.fleetIds).toEqual(["fleet-bot"]);
    expect(gate.queued).toEqual([
      { messageId: "m1", deviceId: "laptop", userId: "morgan@example.test", authorId: "p_morgan", started: false, botId: "desk" },
      { messageId: "m1", deviceId: "studio", userId: "ada@example.test", authorId: "p_morgan", started: false, botId: "other" },
    ]);
    expect(gate.status).toBe("machine-offline");
  });

  it("lets only the owning session pull, and registering does not take the queue", () => {
    const queued = [{ messageId: "m1", deviceId: "laptop", userId: "morgan@example.test", authorId: "p_morgan", started: false }];
    const registered = registerWorkerBody({ workers: [], userId: "morgan@example.test", body: { deviceId: "laptop" } });
    expect(registered.status).toBe(200);
    expect(queued).toEqual([{ messageId: "m1", deviceId: "laptop", userId: "morgan@example.test", authorId: "p_morgan", started: false }]);
    if (registered.status !== 200) return;
    expect(pullQueuedForSession({
      deviceId: "laptop",
      userId: "ada@example.test",
      workers: registered.workers,
      queued,
    })).toEqual({ status: 403, error: "forbidden" });
    expect(pullQueuedForSession({
      deviceId: "laptop",
      userId: "morgan@example.test",
      workers: registered.workers,
      queued,
    })).toEqual({ status: 200, ids: ["m1"], queued: [] });
  });

  it("does not give a later registrant ids held for the previous owner", () => {
    const queued = [{ messageId: "m1", deviceId: "laptop", userId: "morgan@example.test", authorId: "p_morgan", started: false }];
    const stolen = registerWorker([{ deviceId: "laptop", userId: "morgan@example.test", online: true }], {
      deviceId: "laptop",
      userId: "ada@example.test",
      online: true,
    });
    const ada = pullQueuedForSession({
      deviceId: "laptop",
      userId: "ada@example.test",
      workers: stolen,
      queued,
    });
    expect(ada).toEqual({ status: 200, ids: [], queued });
    expect(pullQueuedForSession({
      deviceId: "laptop",
      userId: "morgan@example.test",
      workers: stolen,
      queued,
    })).toEqual({ status: 403, error: "forbidden" });
    const restored = registerWorker(stolen, { deviceId: "laptop", userId: "morgan@example.test", online: true });
    const pulled = pullQueuedForSession({
      deviceId: "laptop",
      userId: "morgan@example.test",
      workers: restored,
      queued,
    });
    expect(pulled).toEqual({ status: 200, ids: ["m1"], queued: [] });
    if (pulled.status !== 200) return;
    expect(pullQueuedForSession({
      deviceId: "laptop",
      userId: "morgan@example.test",
      workers: restored,
      queued: pulled.queued,
    })).toEqual({ status: 200, ids: [], queued: [] });
  });

  it("drops a queued message only when its author cancels", () => {
    const queued = [{ messageId: "m1", deviceId: "laptop", userId: "morgan@example.test", authorId: "p_morgan", started: false }];
    expect(cancelQueued("m1", "ada", queued)).toEqual(queued);
    expect(cancelQueued("m1", "", queued)).toEqual(queued);
    expect(cancelQueued("m1", "p_morgan", queued)).toEqual([]);
  });

  it("keeps partial text and marks the turn failed when the worker drops", () => {
    expect(failTurn({ queued: ["m1"], messageId: "m1", partial: "début" })).toEqual({
      queued: [],
      status: "failed",
      partial: "début",
    });
  });

  it("marks the channel message failed when the worker socket closes mid-turn", () => {
    const partial = "début";
    const card = { tool: "Bash" };
    const earlier = { id: "earlier", text: "historique" };
    const open = { id: "m1", text: partial, card };
    const messages = [earlier, open];
    const result = failTurnOnWorkerClose({
      midTurn: true,
      queued: ["m0", "m1"],
      messageId: "m1",
      partial,
      messages,
    });
    expect(result).toEqual({
      queued: ["m0"],
      status: "failed",
      partial,
      messages: [earlier, { id: "m1", text: partial, card, status: "failed" }],
    });
    expect(result.messages[0]).toBe(earlier);
    expect(result.messages[1]?.card).toBe(card);
    expect(card).toEqual({ tool: "Bash" });
    expect(result.partial).toBe(partial);
    const queued = ["m1"];
    const waiting = failTurnOnWorkerClose({
      midTurn: false,
      queued,
      messageId: "m1",
      partial,
      messages,
    });
    expect(waiting).toEqual({ queued, status: null, partial, messages });
    expect(waiting.queued).toBe(queued);
    expect(waiting.messages).toBe(messages);
  });

  it("fails the same way when a human or a bot leaves during a turn, and keeps history", () => {
    const partial = "début";
    const earlier = { id: "earlier", text: "historique" };
    const open = { id: "m1", text: partial };
    const messages = [earlier, open];
    const shared = {
      queued: ["m1"],
      messageId: "m1",
      partial,
      messages,
    };
    const human = failTurnOnMembershipRemoval({
      beforeHumanIds: ["owner", "ada"],
      afterHumanIds: ["owner"],
      beforeMemberIds: ["bot"],
      afterMemberIds: ["bot"],
      inTurn: true,
      ...shared,
    });
    const bot = failTurnOnMembershipRemoval({
      beforeHumanIds: ["owner"],
      afterHumanIds: ["owner"],
      beforeMemberIds: ["bot", "other"],
      afterMemberIds: ["bot"],
      inTurn: true,
      ...shared,
    });
    expect(human.status).toBe("failed");
    expect(bot.status).toBe("failed");
    expect(human.partial).toBe(partial);
    expect(bot.partial).toBe(partial);
    expect(human.messages.map((message) => message.id)).toEqual(["earlier", "m1"]);
    expect(bot.messages.map((message) => message.id)).toEqual(["earlier", "m1"]);
    expect(human.messages[0]).toBe(earlier);
    expect(bot.messages[0]).toBe(earlier);
    expect(human.messages[1]?.status).toBe("failed");
    expect(human.messages[1]?.text).toBe(partial);
    const idle = failTurnOnMembershipRemoval({
      beforeHumanIds: ["owner", "ada"],
      afterHumanIds: ["owner"],
      beforeMemberIds: ["bot"],
      afterMemberIds: ["bot"],
      inTurn: false,
      ...shared,
    });
    expect(idle).toEqual({ queued: ["m1"], status: null, partial, messages });
    expect(idle.messages).toBe(messages);
    const added = failTurnOnMembershipRemoval({
      beforeHumanIds: ["owner"],
      afterHumanIds: ["owner", "ada"],
      beforeMemberIds: ["bot"],
      afterMemberIds: ["bot", "other"],
      inTurn: true,
      ...shared,
    });
    expect(added.status).toBeNull();
    expect(added.messages).toBe(messages);
  });

  it("calls failTurn when memberIds change during a held turn and keeps the partial", () => {
    const partial = "début";
    const card = { tool: "Bash" };
    const earlier = { id: "earlier", text: "historique" };
    const held = { id: "m1", text: partial, card };
    const messages = [earlier, held];
    const destination = turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: true,
    });
    const calls: string[] = [];
    expect(invokeFleetRunner({ destination, run: () => calls.push("fleet") })).toBe(false);
    expect(calls).toEqual([]);
    const result = memberIdsChangeDuringHeldTurn({
      beforeMemberIds: ["desk", "other"],
      afterMemberIds: ["desk"],
      heldId: "m1",
      queued: ["m1"],
      partial,
      messages,
    });
    const failed = failTurn({ queued: ["m1"], messageId: "m1", partial });
    expect(result.refused).toBe(false);
    expect(result.memberIds).toEqual(["desk"]);
    expect(result.queued).toEqual(failed.queued);
    expect(result.status).toBe(failed.status);
    expect(result.partial).toBe(failed.partial);
    expect(result.partial).toBe(partial);
    expect(result.messages[0]).toBe(earlier);
    expect(result.messages[1]?.text).toBe(partial);
    expect(result.messages[1]?.status).toBe("failed");
    expect(result.messages[1]?.card).toBe(card);
    expect(card).toEqual({ tool: "Bash" });
    const blocked = memberIdsChangeDuringHeldTurn({
      beforeMemberIds: ["desk"],
      afterMemberIds: ["desk", "other"],
      heldId: "m1",
      queued: ["m1"],
      partial,
      messages,
    });
    expect(blocked.refused).toBe(true);
    expect(blocked.memberIds).toEqual(["desk"]);
    expect(blocked.status).toBeNull();
    expect(blocked.partial).toBe(partial);
    expect(blocked.messages).toBe(messages);
  });

  it("fails a pulled turn on a task thread when a person or a bot leaves", () => {
    const partial = "début";
    const card = { tool: "Bash" };
    const earlier = { id: "earlier", text: "historique" };
    const held = { id: "m-task", text: partial, card };
    const messages = [earlier, held];
    const ids = turnsOpenForMembership({
      threadIds: ["room", "task-1"],
      queued: [],
      inflight: [{ messageId: "m-task", threadId: "task-1" }],
    });
    expect(ids).toEqual(["m-task"]);
    const destination = turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: true,
    });
    const calls: string[] = [];
    expect(invokeFleetRunner({ destination, run: () => calls.push("fleet") })).toBe(false);
    expect(calls).toEqual([]);
    const shared = {
      inTurn: true,
      queued: [] as string[],
      messageId: ids[0]!,
      partial,
      messages,
    };
    const human = failTurnOnMembershipRemoval({
      beforeHumanIds: ["owner", "ada"],
      afterHumanIds: ["owner"],
      beforeMemberIds: ["desk"],
      afterMemberIds: ["desk"],
      ...shared,
    });
    const bot = failTurnOnMembershipRemoval({
      beforeHumanIds: ["owner"],
      afterHumanIds: ["owner"],
      beforeMemberIds: ["desk", "other"],
      afterMemberIds: ["desk"],
      ...shared,
    });
    for (const result of [human, bot]) {
      expect(result.status).toBe("failed");
      expect(result.partial).toBe(partial);
      expect(result.messages[0]).toBe(earlier);
      expect(result.messages[1]?.text).toBe(partial);
      expect(result.messages[1]?.status).toBe("failed");
      expect(result.messages[1]?.card).toBe(card);
    }
    expect(card).toEqual({ tool: "Bash" });
  });

  it("fails the pulled ids when that pull socket closes, not every inflight id", () => {
    const partial = "début";
    const card = { tool: "Bash" };
    const earlier = { id: "earlier", text: "historique" };
    const held = { id: "m1", text: partial, card };
    const other = { id: "m2", text: "autre" };
    const messages = [earlier, held, other];
    const partials = { m1: partial, m2: "autre" };
    const registered = failPulledTurnsOnClose({
      source: "register",
      pulledIds: [],
      partials,
      messages,
    });
    expect(registered.failedIds).toEqual([]);
    expect(registered.messages).toBe(messages);
    expect(registered.partials.m1).toBe(partial);
    let close = () => {};
    let finish = () => {};
    const calls: string[] = [];
    bindWorkerSocket({
      socket: { once(_event, listener) { close = listener; } },
      response: { once(_event, listener) { finish = listener; } },
      onClose() { calls.push("pull"); },
    });
    finish();
    close();
    expect(calls).toEqual([]);
    const finished = failPulledTurnsOnClose({
      source: "pull",
      responseFinished: true,
      pulledIds: ["m1"],
      partials,
      messages,
    });
    expect(finished.failedIds).toEqual([]);
    expect(finished.messages).toBe(messages);
    let dropClose = () => {};
    bindWorkerSocket({
      socket: { once(_event, listener) { dropClose = listener; } },
      response: { once() {} },
      onClose() { calls.push("drop"); },
    });
    dropClose();
    expect(calls).toEqual(["drop"]);
    const pulled = failPulledTurnsOnClose({
      source: "drop",
      pulledIds: ["m1"],
      partials,
      messages,
    });
    expect(pulled.failedIds).toEqual(["m1"]);
    expect(pulled.partials.m1).toBe(partial);
    expect(pulled.messages[0]).toBe(earlier);
    expect(pulled.messages.find((message) => message.id === "m1")?.text).toBe(partial);
    expect(pulled.messages.find((message) => message.id === "m1")?.status).toBe("failed");
    expect(pulled.messages.find((message) => message.id === "m1")?.card).toBe(card);
    expect(pulled.messages.find((message) => message.id === "m2")?.status).toBeUndefined();
    expect(card).toEqual({ tool: "Bash" });
    const cancelled = failPulledOnAuthorCancel({
      messageId: "m1",
      authorId: "p_morgan",
      heldAuthorId: "p_morgan",
      partial,
      messages,
    });
    expect(cancelled.failed).toBe(true);
    expect(cancelled.messages.find((message) => message.id === "m1")?.status).toBe("failed");
    expect(failPulledOnAuthorCancel({
      messageId: "m1",
      authorId: "ada",
      heldAuthorId: "p_morgan",
      partial,
      messages,
    }).failed).toBe(false);
    const machine = turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: true,
    });
    const fleetCalls: string[] = [];
    expect(invokeFleetRunner({ destination: machine, run: () => fleetCalls.push("fleet") })).toBe(false);
    expect(fleetCalls).toEqual([]);
  });

  it("registers the session user for the posted deviceId and replaces that device", () => {
    expect(registerWorkerBody({
      workers: [{ deviceId: "laptop", userId: "old@example.test", online: false }],
      userId: "morgan@example.test",
      body: { deviceId: "laptop", userId: "owner@example.test" } as { deviceId?: unknown },
    })).toEqual({
      status: 200,
      worker: { deviceId: "laptop", userId: "morgan@example.test", online: true },
      workers: [{ deviceId: "laptop", userId: "morgan@example.test", online: true }],
    });
  });

  it("refuses a worker registration without a deviceId", () => {
    expect(registerWorkerBody({ workers: [], userId: "morgan@example.test", body: {} })).toEqual({
      status: 400,
      error: "deviceId is required",
    });
    expect(registerWorkerBody({ workers: [], userId: "morgan@example.test", body: { deviceId: "  " } }).status).toBe(400);
    expect(registerWorkerBody({ workers: [], userId: "morgan@example.test", body: null }).status).toBe(400);
  });

  it("lets a session register, pull, and cancel a worker queue at client scope", () => {
    expect(requiredScope("POST", "/api/workers")).toBe("client");
    expect(requiredScope("GET", "/api/workers")).toBe("client");
    expect(requiredScope("POST", "/api/workers/laptop/pull")).toBe("client");
    expect(requiredScope("POST", "/api/workers/laptop/drop")).toBe("client");
    expect(requiredScope("POST", "/api/workers/queue/m1/cancel")).toBe("client");
    expect(requiredScope("GET", "/api/workers/laptop/turns/m1")).toBe("client");
    expect(requiredScope("POST", "/api/workers/laptop/turns/m1")).toBe("client");
  });

  it("publishes the computer name and engines, and lists only that person's computers", () => {
    const registered = registerWorkerBody({
      workers: [{ deviceId: "studio", userId: "ada@example.test", online: true, name: "Ada", engines: [{ instanceId: "pi", label: "pi", models: [{ id: "local", label: "Local" }] }] }],
      userId: "morgan@example.test",
      body: {
        deviceId: "laptop",
        name: "Morgan's Mac",
        engines: [{ instanceId: "pi", label: "pi", driverKind: "piAgent", models: [{ id: "qwen", label: "Qwen" }] }],
      },
      now: 10,
    });
    expect(registered.status).toBe(200);
    if (registered.status !== 200) return;
    expect(registered.worker).toMatchObject({ deviceId: "laptop", userId: "morgan@example.test", name: "Morgan's Mac", online: true, seenAt: 10 });
    expect(workersForSession(registered.workers, "morgan@example.test")).toEqual([{
      deviceId: "laptop",
      name: "Morgan's Mac",
      online: true,
      engines: [{ instanceId: "pi", label: "pi", driverKind: "piAgent", models: [{ id: "qwen", label: "Qwen" }] }],
    }]);
    expect(workersForSession(registered.workers, "ada@example.test").map((worker) => worker.deviceId)).toEqual(["studio"]);
    expect(workersForSession(registered.workers, "morgan@example.test")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ deviceId: "studio" })]),
    );
  });

  it("points a bot only at a computer the caller registered, and only at a model that computer published", () => {
    const workers = [{
      deviceId: "laptop",
      userId: "morgan@example.test",
      online: true,
      engines: [{ instanceId: "pi", label: "pi", models: [{ id: "qwen", label: "Qwen" }] }],
    }];
    expect(assignBotHost({
      callerUserId: "ada@example.test",
      workers,
      host: { kind: "machine", deviceId: "laptop", model: { instanceId: "pi", model: "qwen" } },
    })).toEqual({ ok: false, status: 403, error: "That computer is not registered on your account." });
    expect(assignBotHost({
      callerUserId: "morgan@example.test",
      workers,
      host: { kind: "machine", deviceId: "laptop", model: { instanceId: "pi", model: "other" } },
    }).ok).toBe(false);
    expect(assignBotHost({
      callerUserId: "morgan@example.test",
      workers,
      host: { kind: "machine", deviceId: "laptop", model: { instanceId: "pi", model: "qwen" } },
    })).toEqual({
      ok: true,
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      model: { instanceId: "pi", model: "qwen" },
    });
    expect(assignBotHost({ callerUserId: "morgan@example.test", workers, host: "fleet" })).toEqual({
      ok: true,
      host: { kind: "fleet" },
    });
    const machine = { kind: "machine" as const, userId: "morgan@example.test", deviceId: "laptop" };
    expect(selectionOnMachine({ host: machine, workers, raw: { instanceId: "pi", model: "qwen" } })).toEqual({
      ok: true,
      selection: { instanceId: "pi", model: "qwen" },
    });
    expect(selectionOnMachine({ host: { kind: "fleet" }, workers, raw: { instanceId: "pi", model: "qwen" } })).toBeNull();
  });

  it("holds a direct turn for the computer and does not start it on the fleet", () => {
    const host = { kind: "machine" as const, userId: "morgan@example.test", deviceId: "laptop" };
    expect(directMachinePlan({ host, workers: [] })).toEqual({
      kind: "hold",
      deviceId: "laptop",
      userId: "morgan@example.test",
      online: false,
    });
    const online = directMachinePlan({
      host,
      workers: [{ deviceId: "laptop", userId: "morgan@example.test", online: true }],
    });
    expect(online.kind === "hold" && online.online).toBe(true);
    expect(directMachinePlan({ host: { kind: "fleet" }, workers: [] })).toEqual({ kind: "fleet" });
  });

  it("waits for a queued turn, then stops waiting", async () => {
    expect(pullWaitMs({ wait: true })).toBe(20_000);
    expect(pullWaitMs({})).toBe(0);
    const bell = createTurnBell();
    const pending = bell.wait("laptop", "morgan@example.test", 1_000);
    bell.notify("laptop", "morgan@example.test");
    await expect(pending).resolves.toBe(true);
    await expect(bell.wait("laptop", "ada@example.test", 5)).resolves.toBe(false);
  });

  it("marks a quiet computer offline and accepts a turn report", () => {
    const fresh = [{ deviceId: "laptop", userId: "morgan@example.test", online: true, seenAt: 1_000 }];
    expect(expireWorkers(fresh, 1_000 + 45_000)).toBe(fresh);
    expect(expireWorkers(fresh, 1_000 + 45_001)[0]?.online).toBe(false);
    expect(parseTurnWrite({ kind: "reply", text: "bonjour" })).toEqual({ kind: "reply", text: "bonjour" });
    expect(parseTurnWrite({ kind: "approval", requestId: "req-1", tool: "Bash", summary: "list" })).toMatchObject({
      kind: "approval",
      requestId: "req-1",
      tool: "Bash",
    });
    expect("error" in parseTurnWrite({ kind: "nope" })).toBe(true);
  });
});
