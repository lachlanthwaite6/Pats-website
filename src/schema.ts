import { z } from "zod";
const num = z.number().finite();
const count = num.int().nonnegative();
const text = z.string().max(300);
const day = z.iso.date();
const nullable = num.nullable();
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    meta: z
      .object({
        sourceFile: text,
        sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
        pipelineVersion: text,
        generatedAt: z.iso.datetime({ offset: true }),
        demandAsOf: day,
        rankingAsOf: day,
        eventsAsOf: day,
        isSample: z.boolean(),
      })
      .strict(),
    overview: z
      .object({
        totalCustomers: count,
        frontBook: count,
        backBook: count,
        latestDemandCustomers: count,
        baseTableCustomers: count,
        margin: nullable,
        medianRank: nullable,
        marginAtStake: num,
        churnCost: num,
        cac: nullable,
      })
      .strict(),
    trend: z
      .array(z.object({ week: day, wins: count, losses: count }).strict())
      .min(1)
      .max(2000),
    plans: z
      .array(
        z
          .object({
            code: text.min(1),
            book: z.enum(["Front-Book", "Back-Book"]),
            network: text,
            customerType: text,
            customers: count,
            asOf: day.nullable(),
            recentSignups: count,
            competitors: nullable,
            rank: nullable,
            status: text,
          })
          .strict(),
      )
      .min(1)
      .max(3000),
    elasticity: z
      .object({
        points: z
          .array(
            z
              .object({
                date: day,
                end: day,
                days: count.min(1).max(7),
                rank: num,
                wins: count,
                weeklyRate: num,
              })
              .strict(),
          )
          .max(1000),
        model: z
          .object({
            n: count.min(5),
            slope: num,
            intercept: num,
            r2: nullable,
            xMean: num,
            sxx: num.positive(),
            residualVariance: num.nonnegative(),
            tCritical: num.positive(),
            minRank: num,
            maxRank: num,
          })
          .strict()
          .nullable(),
      })
      .strict(),
    backbook: z
      .array(
        z
          .object({
            status: text,
            plans: count,
            customers: count,
            meanPlanMargin: nullable,
            marginAtStake: num,
            churnCost: num,
          })
          .strict(),
      )
      .max(30),
    competitors: z
      .object({
        lossIdentification: nullable,
        winIdentification: nullable,
        lossEvents: count,
        top: z
          .array(z.object({ name: text, customers: count }).strict())
          .max(50),
      })
      .strict(),
    quality: z
      .array(
        z
          .object({
            code: text,
            severity: z.enum(["info", "warning", "error"]),
            message: z.string().max(1500),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.overview.frontBook + s.overview.backBook !==
      s.overview.totalCustomers
    )
      ctx.addIssue({
        code: "custom",
        message: "Customer totals do not reconcile",
      });
    if (new Set(s.plans.map((r) => r.code)).size !== s.plans.length)
      ctx.addIssue({ code: "custom", message: "Duplicate plan codes" });
    if (
      s.plans.reduce((a, r) => a + r.customers, 0) !== s.overview.totalCustomers
    )
      ctx.addIssue({
        code: "custom",
        message: "Plan and overview counts differ",
      });
    if (
      s.elasticity.model &&
      (s.elasticity.model.minRank > s.elasticity.model.maxRank ||
        s.elasticity.model.n !== s.elasticity.points.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Invalid model bounds/sample count",
      });
  });
export type Snapshot = z.infer<typeof snapshotSchema>;
