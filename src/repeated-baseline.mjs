import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const REPEATED_BASELINE_SCHEMA_VERSION = 1;

function round4(value) {
  return Number(Number(value || 0).toFixed(4));
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  if (values.length === 0) return 0;
  const average = mean(values);
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
}

function assertRoundSummary(round, index) {
  if (!round || typeof round !== 'object' || Array.isArray(round)) {
    throw new Error(`rounds[${index}] must be an object`);
  }
  if (!Array.isArray(round.tasks) || round.tasks.length === 0) {
    throw new Error(`rounds[${index}].tasks must be a non-empty array`);
  }
}

function collectTaskAttempts(rounds) {
  const byTask = new Map();
  for (const [roundIndex, round] of rounds.entries()) {
    for (const task of round.tasks) {
      if (!byTask.has(task.id)) {
        byTask.set(task.id, {
          id: task.id,
          title: task.title,
          attempts: []
        });
      }
      byTask.get(task.id).attempts.push({
        roundIndex: roundIndex + 1,
        score: Number(task.score || 0),
        success: Boolean(task.success),
        status: task.status || '',
        capturePath: task.capturePath || '',
        failedCriteria: Array.isArray(task.failedCriteria) ? task.failedCriteria : []
      });
    }
  }
  return [...byTask.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function failureDistribution(tasks) {
  const counts = new Map();
  for (const task of tasks) {
    for (const attempt of task.attempts) {
      for (const criterion of attempt.failedCriteria) {
        counts.set(criterion, (counts.get(criterion) || 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([criterion, count]) => ({ criterion, count }));
}

export function buildRepeatedBaselineSummary(options = {}) {
  const rounds = options.rounds || [];
  if (!Array.isArray(rounds) || rounds.length < 3) {
    throw new Error('Repeated baseline requires at least 3 rounds.');
  }
  rounds.forEach(assertRoundSummary);

  const tasks = collectTaskAttempts(rounds).map((task) => {
    const scores = task.attempts.map((attempt) => attempt.score);
    const successCount = task.attempts.filter((attempt) => attempt.success).length;
    return {
      id: task.id,
      title: task.title,
      attempts: task.attempts.length,
      successCount,
      passRate: round4(successCount / task.attempts.length),
      meanScore: round4(mean(scores)),
      minScore: round4(Math.min(...scores)),
      maxScore: round4(Math.max(...scores)),
      scoreVariance: round4(variance(scores)),
      scores,
      captures: task.attempts.map((attempt) => ({
        roundIndex: attempt.roundIndex,
        capturePath: attempt.capturePath,
        status: attempt.status,
        success: attempt.success,
        score: attempt.score
      }))
    };
  });

  const allAttempts = tasks.flatMap((task) => task.attempts ? task.attempts : []);
  const allScores = rounds.flatMap((round) => round.tasks.map((task) => Number(task.score || 0)));
  const totalTaskAttempts = rounds.reduce((sum, round) => sum + round.tasks.length, 0);
  const successAttempts = rounds.reduce((sum, round) => sum + round.tasks.filter((task) => task.success).length, 0);

  return {
    schemaVersion: REPEATED_BASELINE_SCHEMA_VERSION,
    source: 'ui-tars-repeated-baseline-summary',
    createdAt: options.createdAt || new Date().toISOString(),
    outputDir: options.outputDir || '',
    roundCount: rounds.length,
    rounds: rounds.map((round, index) => ({
      index: index + 1,
      createdAt: round.createdAt || '',
      outputDir: round.outputDir || '',
      totalTasks: round.totalTasks,
      capturedTasks: round.capturedTasks,
      successTasks: round.successTasks,
      averageScore: round.averageScore
    })),
    totalTaskAttempts,
    overall: {
      averageScore: round4(mean(allScores)),
      scoreVariance: round4(variance(allScores)),
      successRate: round4(successAttempts / totalTaskAttempts)
    },
    tasks,
    failureCriteriaDistribution: failureDistribution(collectTaskAttempts(rounds)),
    _attemptCount: allAttempts.length
  };
}

export async function writeRepeatedBaselineSummary(options = {}) {
  const roundSummaryPaths = options.roundSummaryPaths || [];
  if (!Array.isArray(roundSummaryPaths) || roundSummaryPaths.length === 0) {
    throw new Error('roundSummaryPaths must be a non-empty array.');
  }
  const rounds = [];
  for (const path of roundSummaryPaths) {
    rounds.push(JSON.parse(await readFile(path, 'utf8')));
  }
  const summary = buildRepeatedBaselineSummary({
    outputDir: options.outputDir || dirname(options.outputPath),
    rounds,
    createdAt: options.createdAt
  });
  await mkdir(dirname(options.outputPath), { recursive: true });
  const { _attemptCount, ...serializable } = summary;
  await writeFile(options.outputPath, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
  return serializable;
}
