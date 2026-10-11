import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, type AnalyticsSummary, type MapNodeVisitRank } from '../api'
import { ANIMALS } from '../animalContent'
import { StaffDateRangePicker, useStaffDateRange } from './StaffDateRangePicker'
import { DailyLineChart, HorizontalBarList, SplitDonut } from './StaffAnalyticsCharts'
import './StaffAnalytics.css'

function animalName(slug: string): string {
  return ANIMALS.find((a) => a.slug === slug)?.name ?? slug
}

export function StaffAnalytics() {
  const range = useStaffDateRange()
  const { start, end } = range
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSummary(null)
    setError(null)
    api
      .getAnalyticsSummary(start, end)
      .then(setSummary)
      .catch((err) => setError(String(err)))
  }, [start, end])

  return (
    <section className="staff-analytics">
      <StaffDateRangePicker range={range} />

      {error && <p className="screen-error">Couldn't load analytics: {error}</p>}
      {!error && !summary && <p className="staff-photos-loading">Loading analytics…</p>}

      {summary && (
        <div className="staff-analytics-sections">
          <AnalyticsSection title="Overview / Usage">
            <StatCard label="Total App Users" value={summary.overview.total_users} />
            <ChartCard label="Users Over Time" sublabel="New app users per day">
              <DailyLineChart points={summary.overview.users_over_time.map((p) => ({ date: p.date, value: p.count }))} />
            </ChartCard>
          </AnalyticsSection>

          <AnalyticsSection title="Cobb Coins Economy">
            <StatCard label="Total Coins Earned" value={summary.coins.total_coins_earned} />
            <StatCard
              label="Avg. Coins Earned per User"
              value={summary.coins.avg_coins_per_user.toFixed(2)}
              caption="Per app user, not per coin-earner"
            />
          </AnalyticsSection>

          <AnalyticsSection title="Scavenger Hunt">
            <StatCard
              label="Average Completion Rate"
              value={`${summary.hunt.avg_completion_rate_pct.toFixed(0)}%`}
              caption="Avg. share of characters found per user"
            />
            <ChartCard label="% of Users Who Found Each Character">
              <HorizontalBarList
                items={summary.hunt.character_found_rates.map((r) => ({ label: r.name, value: r.found_pct }))}
                format={(v) => `${v.toFixed(0)}%`}
              />
            </ChartCard>
          </AnalyticsSection>

          <AnalyticsSection title="Bingo">
            <StatCard label="Average Number of Tiles Completed" value={`${summary.bingo.avg_tiles_completed.toFixed(1)} tiles`} />
            <StatCard label="Avg. Milestones Earned per User" value={summary.bingo.avg_milestones_per_session.toFixed(2)} />
          </AnalyticsSection>

          <AnalyticsSection title="Map Exploration">
            <StatCard
              label="Avg. Nodes Visited per User"
              value={summary.map_exploration.avg_nodes_visited_per_session.toFixed(1)}
            />
            <ChartCard label="Most / Least Visited Nodes">
              <NodeRankings rankings={summary.map_exploration.node_rankings} />
            </ChartCard>
            <div className="cap-parchment-card staff-analytics-stat-card">
              <span className="staff-analytics-card-label">Visit Heatmap</span>
              <span className="staff-analytics-card-caption">Every check-in by map location, filterable by day and hour</span>
              <Link to="/staff/heatmap" className="btn btn-secondary staff-analytics-heatmap-link">
                Open Visit Heatmap
              </Link>
            </div>
          </AnalyticsSection>

          <AnalyticsSection title="Collectibles">
            <ChartCard label="Most Purchased Animal">
              <HorizontalBarList
                items={summary.collectibles.most_purchased
                  .slice(0, 5)
                  .map((r) => ({ label: animalName(r.animal_slug), value: r.count }))}
              />
            </ChartCard>
          </AnalyticsSection>

          <AnalyticsSection title="Puzzle Timer / Scoring Sheets">
            <StatCard
              label="Puzzle Timer Solves"
              value={summary.puzzle_scoring.puzzle_timer_solves}
              caption="Every recorded attempt is a solve -- this app doesn't track abandoned attempts"
            />
            <StatCard label="Scoring Sheet Attempts" value={summary.puzzle_scoring.scoring_sheet_attempts} />
            <StatCard label="Scoring Sheet Completions" value={summary.puzzle_scoring.scoring_sheet_completions} />
          </AnalyticsSection>

          <AnalyticsSection title="Photos & Passport">
            <StatCard label="Photos Submitted" value={summary.photos_passport.photos_submitted} />
            <StatCard
              label="% of Users Voting on Photo of the Day"
              value={`${summary.photos_passport.pct_sessions_voting.toFixed(0)}%`}
            />
            <StatCard label="Family Passports Generated" value={summary.photos_passport.passports_generated} />
          </AnalyticsSection>

          <AnalyticsSection title="Overall Engagement">
            <StatCard
              label="Full Completionist Rate"
              value={`${summary.engagement.full_completionist_rate_pct.toFixed(1)}%`}
              caption="% of users who completed the Scavenger Hunt, a Bingo Blackout, and full Map Exploration, and generated a Family Passport"
            />
            <ChartCard label="Full Completionist Rate Over Time">
              <DailyLineChart
                points={summary.engagement.full_completionist_trend.map((p) => ({ date: p.date, value: p.pct }))}
                valueSuffix="%"
              />
            </ChartCard>
          </AnalyticsSection>

          <AnalyticsSection title="Staff Operations">
            <StatCard label="Total Contact Staff Requests" value={summary.staff_ops.total_requests} />
            <ChartCard label="General vs. Emergency">
              <SplitDonut
                segments={[
                  { label: 'General', value: summary.staff_ops.general_count, color: 'var(--cap-color-adventure-green)' },
                  { label: 'Emergency', value: summary.staff_ops.emergency_count, color: 'var(--cap-color-contact-red)' },
                ]}
              />
            </ChartCard>
          </AnalyticsSection>
        </div>
      )}
    </section>
  )
}

function AnalyticsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="staff-analytics-section">
      <h2 className="staff-photos-subheading">{title}</h2>
      <div className="staff-analytics-cards">{children}</div>
    </div>
  )
}

function StatCard({ label, value, caption }: { label: string; value: string | number; caption?: string }) {
  return (
    <div className="cap-parchment-card staff-analytics-stat-card">
      <span className="staff-analytics-card-label">{label}</span>
      <span className="staff-analytics-stat-value">{value}</span>
      {caption && <span className="staff-analytics-card-caption">{caption}</span>}
    </div>
  )
}

function ChartCard({ label, sublabel, children }: { label: string; sublabel?: string; children: ReactNode }) {
  return (
    <div className="cap-parchment-card staff-analytics-chart-card">
      <span className="staff-analytics-card-label">{label}</span>
      {sublabel && <span className="staff-analytics-card-sublabel">{sublabel}</span>}
      {children}
    </div>
  )
}

function NodeRankings({ rankings }: { rankings: MapNodeVisitRank[] }) {
  if (rankings.length === 0) return <p className="staff-photos-empty">No map visits recorded in this range.</p>
  const most = rankings.slice(0, 3)
  const least = [...rankings].reverse().slice(0, 3)
  return (
    <div className="staff-analytics-node-rankings">
      <div>
        <span className="staff-analytics-ranking-heading">Most Visited</span>
        <HorizontalBarList items={most.map((r) => ({ label: r.name, value: r.visits }))} />
      </div>
      {rankings.length > 3 && (
        <div>
          <span className="staff-analytics-ranking-heading">Least Visited</span>
          <HorizontalBarList items={least.map((r) => ({ label: r.name, value: r.visits }))} />
        </div>
      )}
    </div>
  )
}
