const seatLetters = ["A", "B", "C", "D", "E", "F"];
const leftSide = new Set(["A", "B", "C"]);
const windowSeats = new Set(["A", "F"]);
const middleSeats = new Set(["B", "E"]);
const aisleSeats = new Set(["C", "D"]);

const strategyNames = {
  random: "랜덤 탑승",
  backToFront: "뒷자리부터 탑승",
  windowFirst: "창가자리부터 탑승",
  wilma: "WilMA",
  insideOutOddEven: "안쪽부터 홀짝 분산",
  reversePyramid: "역피라미드",
};

const strategyNotes = {
  random: "랜덤 방식은 구현이 쉽지만 앞쪽 승객과 뒤쪽 승객이 섞여 통로 병목이 자주 생깁니다.",
  backToFront: "뒷자리부터 태우면 목적 행 충돌은 줄지만 같은 구역의 짐 싣기 대기열이 길어질 수 있습니다.",
  windowFirst: "창가 승객을 먼저 태우면 좌석 간섭이 줄어 전체 지연을 낮출 수 있습니다.",
  wilma: "WilMA는 창가, 중간, 통로 순서로 태워 좌석 간섭 비용을 크게 줄이는 전략입니다.",
  insideOutOddEven: "안쪽부터 홀짝 분산은 창가 짝수, 창가 홀수, 중간 짝수, 중간 홀수, 통로 짝수, 통로 홀수 순서로 탑승시켜 좌석 간섭과 같은 행 주변 정체를 함께 줄입니다.",
  reversePyramid: "역피라미드는 뒤쪽 창가부터 앞쪽 통로까지 퍼뜨려 통로와 좌석 간섭을 동시에 줄이려는 방식입니다.",
};

const state = {
  rows: 18,
  loadFactor: 92,
  bagTime: 4,
  arrivalRate: 13,
  serviceRate: 7,
  gateServers: 2,
  speed: 5,
  strategy: "random",
  running: false,
  timer: null,
  tickMs: 220,
  sim: null,
};

const els = {
  strategy: document.querySelector("#strategy"),
  loadFactor: document.querySelector("#loadFactor"),
  rows: document.querySelector("#rows"),
  bagTime: document.querySelector("#bagTime"),
  arrivalRate: document.querySelector("#arrivalRate"),
  serviceRate: document.querySelector("#serviceRate"),
  gateServers: document.querySelector("#gateServers"),
  speed: document.querySelector("#speed"),
  loadFactorLabel: document.querySelector("#loadFactorLabel"),
  rowsLabel: document.querySelector("#rowsLabel"),
  bagTimeLabel: document.querySelector("#bagTimeLabel"),
  arrivalRateLabel: document.querySelector("#arrivalRateLabel"),
  serviceRateLabel: document.querySelector("#serviceRateLabel"),
  gateServersLabel: document.querySelector("#gateServersLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  totalTime: document.querySelector("#totalTime"),
  blockedTicks: document.querySelector("#blockedTicks"),
  seatInterference: document.querySelector("#seatInterference"),
  rhoValue: document.querySelector("#rhoValue"),
  lqValue: document.querySelector("#lqValue"),
  wqValue: document.querySelector("#wqValue"),
  releaseValue: document.querySelector("#releaseValue"),
  mmNote: document.querySelector("#mmNote"),
  totalPassengersValue: document.querySelector("#totalPassengersValue"),
  remainingPassengersValue: document.querySelector("#remainingPassengersValue"),
  currentMuValue: document.querySelector("#currentMuValue"),
  avgTransitionValue: document.querySelector("#avgTransitionValue"),
  ltChart: document.querySelector("#ltChart"),
  queue: document.querySelector("#queue"),
  aircraft: document.querySelector("#aircraft"),
  comparisonChart: document.querySelector("#comparisonChart"),
  events: document.querySelector("#events"),
  strategyNote: document.querySelector("#strategyNote"),
  runBtn: document.querySelector("#runBtn"),
  pauseBtn: document.querySelector("#pauseBtn"),
  resetBtn: document.querySelector("#resetBtn"),
  compareBtn: document.querySelector("#compareBtn"),
};

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function seatType(seat) {
  if (windowSeats.has(seat)) return 0;
  if (middleSeats.has(seat)) return 1;
  return 2;
}

function rowBand(row, rows) {
  if (row > rows * 0.66) return 0;
  if (row > rows * 0.33) return 1;
  return 2;
}

function factorial(value) {
  let result = 1;
  for (let i = 2; i <= value; i += 1) result *= i;
  return result;
}

function mmcMetrics(lambda = state.arrivalRate, mu = state.serviceRate, servers = state.gateServers) {
  const rho = lambda / (servers * mu);
  const capacityRate = Math.min(lambda, servers * mu);
  const releaseInterval = 60 / Math.max(capacityRate, 0.1);

  if (rho >= 1) {
    return {
      rho,
      lq: Infinity,
      wqSeconds: Infinity,
      releaseInterval,
      stable: false,
    };
  }

  const traffic = lambda / mu;
  let sum = 0;
  for (let n = 0; n < servers; n += 1) {
    sum += traffic ** n / factorial(n);
  }
  const last = traffic ** servers / (factorial(servers) * (1 - rho));
  const p0 = 1 / (sum + last);
  const lq = (p0 * traffic ** servers * rho) / (factorial(servers) * (1 - rho) ** 2);
  const wqSeconds = (lq / lambda) * 60;

  return {
    rho,
    lq,
    wqSeconds,
    releaseInterval,
    stable: true,
  };
}

function insideOutOddEvenGroup(passenger) {
  return seatType(passenger.seat) * 2 + (passenger.row % 2 === 0 ? 0 : 1);
}

function makePassengerList(rows, loadFactor, random) {
  const seats = [];
  for (let row = 1; row <= rows; row += 1) {
    for (const seat of seatLetters) seats.push({ row, seat, id: `${row}${seat}` });
  }
  return shuffle(seats, random).slice(0, Math.round(seats.length * (loadFactor / 100)));
}

function orderPassengers(passengers, strategy, rows, random) {
  const withTie = passengers.map((passenger) => ({ ...passenger, tie: random() }));
  const bySeatType = (a, b) => seatType(a.seat) - seatType(b.seat) || b.row - a.row || a.tie - b.tie;

  if (strategy === "random") return shuffle(withTie, random);
  if (strategy === "backToFront") return withTie.sort((a, b) => b.row - a.row || a.tie - b.tie);
  if (strategy === "windowFirst") return withTie.sort((a, b) => bySeatType(a, b));
  if (strategy === "wilma") return withTie.sort((a, b) => seatType(a.seat) - seatType(b.seat) || a.tie - b.tie);
  if (strategy === "insideOutOddEven") {
    return withTie.sort((a, b) => insideOutOddEvenGroup(a) - insideOutOddEvenGroup(b) || b.row - a.row || a.tie - b.tie);
  }

  return withTie.sort((a, b) => {
    const bandDiff = rowBand(a.row, rows) - rowBand(b.row, rows);
    return bandDiff || seatType(a.seat) - seatType(b.seat) || b.row - a.row || a.tie - b.tie;
  });
}

function interferenceFor(passenger, occupied) {
  const { row, seat } = passenger;
  const rowSeats = occupied.get(row) || new Set();
  const blockers = leftSide.has(seat)
    ? seatLetters.filter((candidate) => leftSide.has(candidate) && seatLetters.indexOf(candidate) > seatLetters.indexOf(seat))
    : seatLetters.filter((candidate) => !leftSide.has(candidate) && seatLetters.indexOf(candidate) < seatLetters.indexOf(seat));
  return blockers.filter((candidate) => rowSeats.has(candidate)).length;
}

function seatedCount(sim) {
  if (!sim) return 0;
  let count = 0;
  for (const rowSeats of sim.seated.values()) count += rowSeats.size;
  return count;
}

function remainingCount(sim) {
  if (!sim) return 0;
  return sim.passengers.length - seatedCount(sim);
}

function recordTransition(sim) {
  const duration = sim.time - sim.lastTransitionTime;
  if (duration <= 0) return;
  sim.transitionSamples.push({
    n: remainingCount(sim),
    duration,
    muPerMinute: 60 / duration,
  });
  sim.lastTransitionTime = sim.time;
}

function recordPopulationHistory(sim) {
  const n = remainingCount(sim);
  const last = sim.populationHistory[sim.populationHistory.length - 1];
  if (!last || last.time !== sim.time || last.n !== n) {
    sim.populationHistory.push({ time: sim.time, n });
  }
  if (sim.populationHistory.length > 180) sim.populationHistory.shift();
}

function createSimulation(strategy = state.strategy, animate = true) {
  const random = mulberry32(20260520);
  const passengers = makePassengerList(state.rows, state.loadFactor, random);
  const queue = orderPassengers(passengers, strategy, state.rows, random).map((passenger, index) => ({
    ...passenger,
    label: passenger.id,
    index,
    position: -1,
    status: "queue",
    wait: 0,
    bagDuration: 0,
    interference: 0,
  }));

  return {
    animate,
    strategy,
    time: 0,
    nextIndex: 0,
    aisle: Array(state.rows).fill(null),
    seated: new Map(),
    passengers: queue,
    nextGateRelease: 0,
    gateHoldTicks: 0,
    lastTransitionTime: 0,
    transitionSamples: [],
    populationHistory: [{ time: 0, n: queue.length }],
    blockedTicks: 0,
    seatInterference: 0,
    events: [],
    done: false,
  };
}

function addEvent(sim, text) {
  sim.events.unshift(`[${sim.time}초] ${text}`);
  sim.events = sim.events.slice(0, 9);
}

function markSeatOccupied(sim, passenger) {
  if (!sim.seated.has(passenger.row)) sim.seated.set(passenger.row, new Set());
  sim.seated.get(passenger.row).add(passenger.seat);
}

function stepSimulation(sim) {
  if (sim.done) return;
  sim.time += 1;

  for (let row = state.rows - 1; row >= 0; row -= 1) {
    const passenger = sim.aisle[row];
    if (!passenger) continue;

    const targetPosition = passenger.row - 1;

    if (passenger.status === "loading") {
      passenger.wait -= 1;
      if (passenger.wait <= 0) {
        passenger.status = "seated";
        sim.aisle[row] = null;
        recordTransition(sim);
        markSeatOccupied(sim, passenger);
        addEvent(sim, `${passenger.label} 승객 착석 완료`);
      }
      continue;
    }

    if (row === targetPosition) {
      passenger.interference = interferenceFor(passenger, sim.seated);
      passenger.bagDuration = state.bagTime + passenger.interference * 3 + Math.floor(passenger.tie * 3);
      passenger.wait = passenger.bagDuration;
      passenger.status = "loading";
      sim.seatInterference += passenger.interference;
      if (passenger.interference > 0) {
        addEvent(sim, `${passenger.label} 좌석 진입 중 ${passenger.interference}명 비켜섬`);
      }
      continue;
    }

    const nextRow = row + 1;
    if (nextRow < state.rows && sim.aisle[nextRow] === null) {
      sim.aisle[nextRow] = passenger;
      sim.aisle[row] = null;
      passenger.position = nextRow;
    } else {
      sim.blockedTicks += 1;
    }
  }

  const gate = mmcMetrics();
  const canReleaseFromGate = sim.time >= sim.nextGateRelease;

  if (sim.nextIndex < sim.passengers.length && sim.aisle[0] === null && canReleaseFromGate) {
    const passenger = sim.passengers[sim.nextIndex];
    passenger.status = "moving";
    passenger.position = 0;
    sim.aisle[0] = passenger;
    sim.nextIndex += 1;
    sim.nextGateRelease = sim.time + gate.releaseInterval;
  } else if (sim.nextIndex < sim.passengers.length && sim.aisle[0] !== null) {
    sim.blockedTicks += 1;
  } else if (sim.nextIndex < sim.passengers.length && !canReleaseFromGate) {
    sim.gateHoldTicks += 1;
  }

  sim.done = sim.nextIndex >= sim.passengers.length && sim.aisle.every((spot) => spot === null);
  recordPopulationHistory(sim);
}

function renderAircraft() {
  const sim = state.sim;
  els.aircraft.innerHTML = "";

  for (let row = state.rows; row >= 1; row -= 1) {
    const rowEl = document.createElement("div");
    rowEl.className = "row";

    const rowNumber = document.createElement("div");
    rowNumber.className = "row-number";
    rowNumber.textContent = row;
    rowEl.appendChild(rowNumber);

    for (const seat of ["A", "B", "C"]) rowEl.appendChild(renderSeat(row, seat, sim));

    const aisle = document.createElement("div");
    aisle.className = "aisle-cell";
    const passenger = sim?.aisle[row - 1];
    if (passenger) aisle.appendChild(renderPassenger(passenger));
    rowEl.appendChild(aisle);

    for (const seat of ["D", "E", "F"]) rowEl.appendChild(renderSeat(row, seat, sim));

    els.aircraft.appendChild(rowEl);
  }
}

function renderSeat(row, seat, sim) {
  const seatEl = document.createElement("div");
  seatEl.className = "seat";
  seatEl.textContent = seat;
  if (sim?.seated.get(row)?.has(seat)) seatEl.classList.add("occupied");
  if (sim?.aisle[row - 1]?.row === row && sim.aisle[row - 1].seat === seat) seatEl.classList.add("target");
  return seatEl;
}

function renderPassenger(passenger) {
  const dot = document.createElement("div");
  dot.className = `passenger ${passenger.status === "loading" ? "loading" : ""}`;
  dot.textContent = passenger.label;
  dot.title = `${passenger.label} 좌석으로 이동 중`;
  return dot;
}

function renderQueue() {
  const sim = state.sim;
  els.queue.innerHTML = '<div class="queue-label">대기열</div>';
  if (!sim) return;
  const waiting = sim.passengers.slice(sim.nextIndex, sim.nextIndex + 20);
  for (const passenger of waiting) {
    const chip = document.createElement("div");
    chip.className = "queue-chip";
    chip.textContent = passenger.label;
    els.queue.appendChild(chip);
  }
}

function renderStats() {
  const sim = state.sim;
  const gate = mmcMetrics();
  els.totalTime.textContent = `${sim?.time || 0}초`;
  els.blockedTicks.textContent = `${sim?.blockedTicks || 0}회`;
  els.seatInterference.textContent = `${sim?.seatInterference || 0}회`;
  els.strategyNote.textContent = strategyNotes[state.strategy];
  els.rhoValue.textContent = Number.isFinite(gate.rho) ? gate.rho.toFixed(2) : "불안정";
  els.lqValue.textContent = Number.isFinite(gate.lq) ? `${gate.lq.toFixed(1)}명` : "무한대";
  els.wqValue.textContent = Number.isFinite(gate.wqSeconds) ? `${gate.wqSeconds.toFixed(1)}초` : "무한대";
  els.releaseValue.textContent = `${gate.releaseInterval.toFixed(1)}초`;
  els.mmNote.textContent = gate.stable
    ? `λ=${state.arrivalRate}명/분, μ=${state.serviceRate}명/분, c=${state.gateServers}일 때 ρ<1이라 안정 상태입니다. 평균적으로 ${gate.releaseInterval.toFixed(1)}초마다 승객이 기내 단계로 넘어갑니다.`
    : `λ가 cμ보다 커서 ρ≥1입니다. 이 경우 M/M/c 대기열은 안정 상태가 아니므로 게이트 앞 대기열이 계속 증가합니다.`;
}

function renderPopulationChart(sim) {
  if (!sim || !els.ltChart) return;
  const history = sim.populationHistory.length ? sim.populationHistory : [{ time: 0, n: sim.passengers.length }];
  const width = 520;
  const height = 150;
  const pad = 22;
  const maxTime = Math.max(...history.map((point) => point.time), 1);
  const maxN = Math.max(sim.passengers.length, 1);
  const points = history.map((point) => {
    const x = pad + (point.time / maxTime) * (width - pad * 2);
    const y = pad + ((maxN - point.n) / maxN) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = [`${pad},${height - pad}`, ...points, `${width - pad},${height - pad}`].join(" ");

  els.ltChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="L(t) graph">
      <line class="lt-axis" x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}"></line>
      <line class="lt-axis" x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}"></line>
      <polygon class="lt-area" points="${areaPoints}"></polygon>
      <polyline class="lt-line" points="${points.join(" ")}"></polyline>
      <text class="lt-label" x="${pad}" y="15">L(t)=미착석 승객 수</text>
      <text class="lt-label" x="${width - 92}" y="${height - 7}">${maxTime}초</text>
      <text class="lt-label" x="4" y="${pad + 4}">${maxN}명</text>
      <text class="lt-label" x="8" y="${height - pad}">0</text>
    </svg>
  `;
}

function renderPureDeath() {
  const sim = state.sim;
  if (!sim) return;
  const latest = sim.transitionSamples[sim.transitionSamples.length - 1];
  const avgDuration = sim.transitionSamples.length
    ? sim.transitionSamples.reduce((sum, sample) => sum + sample.duration, 0) / sim.transitionSamples.length
    : null;

  els.totalPassengersValue.textContent = `${sim.passengers.length}명`;
  els.remainingPassengersValue.textContent = `${remainingCount(sim)}명`;
  els.currentMuValue.textContent = latest ? `${latest.muPerMinute.toFixed(2)}명/분` : "-";
  els.avgTransitionValue.textContent = avgDuration ? `${avgDuration.toFixed(1)}초` : "-";
  renderPopulationChart(sim);
}

function renderEvents() {
  const sim = state.sim;
  els.events.innerHTML = "";
  const events = sim?.events.length ? sim.events : ["시뮬레이션 이벤트가 여기에 표시됩니다."];
  for (const text of events) {
    const event = document.createElement("div");
    event.className = "event";
    event.textContent = text;
    els.events.appendChild(event);
  }
}

function renderAll() {
  renderAircraft();
  renderQueue();
  renderStats();
  renderPureDeath();
  renderEvents();
}

function runLoop() {
  clearInterval(state.timer);
  state.timer = setInterval(() => {
    if (!state.running || !state.sim) return;
    const steps = Math.max(1, Math.floor(state.speed / 2));
    for (let i = 0; i < steps; i += 1) stepSimulation(state.sim);
    renderAll();
    if (state.sim.done) {
      state.running = false;
      els.runBtn.textContent = "다시 시작";
    }
  }, Math.max(35, state.tickMs - state.speed * 17));
}

function resetSimulation(keepRunning = false) {
  state.sim = createSimulation(state.strategy);
  state.running = keepRunning;
  els.runBtn.textContent = keepRunning ? "실행 중" : "시작";
  renderAll();
  runLoop();
}

function simulateToEnd(strategy) {
  const previous = state.sim;
  const sim = createSimulation(strategy, false);
  let guard = 0;
  while (!sim.done && guard < 10000) {
    stepSimulation(sim);
    guard += 1;
  }
  state.sim = previous;
  return sim;
}

function renderComparison(results) {
  const maxTime = Math.max(...results.map((result) => result.time), 1);
  els.comparisonChart.innerHTML = "";
  for (const result of results) {
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label">${strategyNames[result.strategy]}</div>
      <div class="bar-track"><div class="bar" style="width: ${(result.time / maxTime) * 100}%"></div></div>
      <div class="bar-value">${result.time}초</div>
    `;
    els.comparisonChart.appendChild(row);
  }
}

function compareStrategies() {
  const results = Object.keys(strategyNames)
    .map((strategy) => {
      const sim = simulateToEnd(strategy);
      return {
        strategy,
        time: sim.time,
        blockedTicks: sim.blockedTicks,
        seatInterference: sim.seatInterference,
      };
    })
    .sort((a, b) => a.time - b.time);

  renderComparison(results);
}

function updateSettingsFromControls() {
  state.strategy = els.strategy.value;
  state.loadFactor = Number(els.loadFactor.value);
  state.rows = Number(els.rows.value);
  state.bagTime = Number(els.bagTime.value);
  state.arrivalRate = Number(els.arrivalRate.value);
  state.serviceRate = Number(els.serviceRate.value);
  state.gateServers = Number(els.gateServers.value);
  state.speed = Number(els.speed.value);

  els.loadFactorLabel.textContent = state.loadFactor;
  els.rowsLabel.textContent = state.rows;
  els.bagTimeLabel.textContent = state.bagTime;
  els.arrivalRateLabel.textContent = state.arrivalRate;
  els.serviceRateLabel.textContent = state.serviceRate;
  els.gateServersLabel.textContent = state.gateServers;
  els.speedLabel.textContent = state.speed;
  els.strategyNote.textContent = strategyNotes[state.strategy];
}

function bindControls() {
  for (const control of [els.strategy, els.loadFactor, els.rows, els.bagTime, els.arrivalRate, els.serviceRate, els.gateServers, els.speed]) {
    control.addEventListener("input", () => {
      updateSettingsFromControls();
      if (control !== els.speed) resetSimulation(false);
      else runLoop();
      compareStrategies();
    });
  }

  els.runBtn.addEventListener("click", () => {
    if (!state.sim || state.sim.done) resetSimulation(true);
    state.running = true;
    els.runBtn.textContent = "실행 중";
    runLoop();
  });

  els.pauseBtn.addEventListener("click", () => {
    state.running = false;
    els.runBtn.textContent = "계속";
  });

  els.resetBtn.addEventListener("click", () => resetSimulation(false));
  els.compareBtn.addEventListener("click", compareStrategies);
}

updateSettingsFromControls();
bindControls();
resetSimulation(false);
compareStrategies();
