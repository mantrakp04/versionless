import { pgTable, text } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * THE single parent source for all demo types. Everything downstream derives
 * from these tables: zod schemas via drizzle-zod, wire types via z.infer,
 * old wire shapes in change files via Omit/&, client SDK types via
 * ClientTypes. Nothing redefines a field.
 */

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull().unique(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  memberIds: text("member_ids").array().notNull().default([]),
});

// --- derived zod schemas (drizzle-zod) -------------------------------------

export const userSchema = createSelectSchema(users, {
  email: (s) => s.pipe(z.email()),
});
export const userCreateSchema = createInsertSchema(users, {
  email: (s) => s.pipe(z.email()),
}).omit({ id: true });

export const teamSchema = createSelectSchema(teams);

// --- derived wire types -----------------------------------------------------

export type User = z.infer<typeof userSchema>;
export type UserCreate = z.infer<typeof userCreateSchema>;
export type Team = z.infer<typeof teamSchema>;
