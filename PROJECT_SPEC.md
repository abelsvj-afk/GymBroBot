# GymBroBot — Project Specification

This document captures the intended full feature set and behavior for GymBroBot. Use this as the canonical feature spec to compare the repository implementation against the original intentions.

## Core Setup
- Built with Node.js + discord.js v14.
- Uses `.env` for secrets: `DISCORD_TOKEN`, `OPENAI_API_KEY`.
- Express server runs alongside the bot for status/uptime checks.
- Persistent storage via JSON files (`/data/`) for memory, fitness, habits, partner system, strikes, etc.

## AI Integration
- OpenAI (ChatGPT) API integrated for:
  - Coach responses (`!coach <question>`): short, motivational fitness coaching answers.
  - Random motivational replies (approx ~15% chance on normal messages).
  - Daily 9 AM motivation messages to a general/main channel.

## Fitness Tracking
- `!track yes/no` → logs workout done.
- `!progress` → shows weekly stats (✅, ❌, success rate, colored embed).
- `!leaderboard` → ranks top performers for the week.
- Weekly reset at Sunday midnight.

## Habit Tracking
- `!addhabit <habit>` → start tracking a habit.
- `!habits` → view tracked habits + streaks.
- `!check <habit>` → mark habit as complete for today (increments streaks).
- Data saved per-user across restarts.

## Coaching & Motivation
- `!coach` → AI fitness coaching.
- `!quote` → random motivational quote.
- `!workoutplan [push/pull/legs/general]` → returns structured workout template.

## Partner System (Accountability & Future Partners)
- Two systems:
  - Goal Partners: auto-match or queue users for accountability; creates private text channel for pair; pinned rules & check-in template; check-in reminders.
  - Future Partners: incremental "exposure" reveal of hidden info based on days and messages exchanged; tiers unlock over time; both users notified on unlock.

## Moderation & Safety
- Strikes system: violations = strike; 3 strikes → channel deletion + block from future matches (goal partners). Future partners stricter (e.g., leaks).
- Logging channel (`#logging`) receives strike notices & channel deletions.
- DMs sent to offending user when they receive a strike.

## Leaderboards & Channels
- Fitness Leaderboard (`!leaderboard`).
- Future Partners Leaderboard (symbolic, potential matches). Both refresh automatically when data changes.

## Automated Jobs
Uses a scheduler (e.g., `node-cron`) for:
- Daily (9 AM) → Motivation messages.
- Weekly (Sunday midnight) → Fitness reset.
- Auto-match loop (e.g., every 30s) → pairs queued users if possible.
- Partner check-in reminders.

## Memory System
- Stores last N messages per user for lightweight context recall.
- Used to slightly personalize AI motivational replies.

## Private Channel Setup
- Auto-created on match with proper permissions (pair + admins/mods/owner).
- Rules + templates pinned automatically.

## Error Handling
- Robust try/catch on API calls and safe file I/O.

## Commands Summary
- `!help`, `!coach`, `!quote`, `!workoutplan`, `!track`, `!progress`, `!leaderboard`, `!addhabit`, `!habits`, `!check`.

## Notes for Cross-Reference
When comparing implementation to this spec, check for:
- Presence of private-channel creation and pinning logic.
- Exposure tier mechanics and unlock conditions for Future Partners.
- Cron jobs for daily/weekly/auto-match operations.
- Admin tools: `!forcematch`, `!unpair`, strike management.
- OpenAI usage and model validation fallback.

---

If you want, I can now cross-check the repository against this spec and produce a mapping of implemented/partial/missing items and optionally implement small missing functions or add TODOs. Tell me to proceed and I'll start the automated cross-reference.
