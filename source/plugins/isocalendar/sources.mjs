/**Default colors for external sources (used when neither source settings nor source data specify one) */
const colors = {
  file: "#fb8f44",
  gitlab: "#fc6d26",
}

/**GitLab event actions that are not contributions */
const ignored = {
  gitlab: ["joined", "left", "expired"],
}

/**Convert a date to its "YYYY-MM-DD" representation (UTC) */
export function day(date) {
  return new Date(date).toISOString().substring(0, 10)
}

/**Load contributions from all external sources */
export async function load({login, sources, start, end, imports}) {
  const results = []
  for (const [index, source] of Object.entries(sources ?? [])) {
    const {type} = source
    const name = source.name ?? `${type}-${index}`
    if (!(type in loaders)) {
      console.debug(`metrics/compute/${login}/plugins > isocalendar > unsupported source type "${type}" for source "${name}", skipping`)
      continue
    }
    try {
      console.debug(`metrics/compute/${login}/plugins > isocalendar > loading source "${name}" (${type})`)
      const days = await loaders[type]({login, source, start, end, imports})
      //Resolve colors (source settings > source data > default)
      for (const entry of days.values())
        entry.color = source.color ?? entry.color ?? colors[type]
      results.push({name, color: source.color ?? colors[type], days})
      console.debug(`metrics/compute/${login}/plugins > isocalendar > loaded source "${name}" (${days.size} days)`)
    }
    catch (error) {
      console.warn(`metrics/compute/${login}/plugins > isocalendar > failed to load source "${name}": ${error.message}`)
    }
  }
  return results
}

/**Loaders (each returns a Map of "YYYY-MM-DD" => {count, color?}) */
const loaders = {
  //JSON file served over http(s)
  //Accepted formats:
  //- [{date: "YYYY-MM-DD", contributionCount: number, color?: string}, ...] ("count" is also accepted)
  //- {"YYYY-MM-DD": number, ...} (format of GitLab's /users/:username/calendar.json)
  async file({source: {url, headers = {}}, start, end, imports}) {
    if (!url)
      throw new Error('missing "url"')
    const {data} = await imports.axios.get(url, {headers})
    const entries = Array.isArray(data) ? data.map(({date, contributionCount, count, color}) => [date, contributionCount ?? count, color]) : Object.entries(data ?? {})
    const days = new Map()
    for (const [date, count, color] of entries) {
      const key = day(date)
      if ((new Date(key) < new Date(day(start))) || (new Date(key) > end))
        continue
      const entry = days.get(key) ?? {count: 0}
      entry.count += Number(count) || 0
      entry.color = color ?? entry.color
      days.set(key, entry)
    }
    return days
  },

  //GitLab events API (authenticated user's own events)
  //- url: GitLab instance (default: https://gitlab.com)
  //- token: personal access token with "read_user" scope
  //- count: "events" (each event is one contribution, like GitLab calendar) or "commits" (pushed commits)
  async gitlab({login, source: {url = "https://gitlab.com", token, count = "events"}, start, end, imports}) {
    if (!token)
      throw new Error('missing "token"')
    const days = new Map()
    //GitLab "after" and "before" filters are exclusive
    const after = new Date(start)
    after.setUTCDate(after.getUTCDate() - 1)
    const before = new Date(end)
    before.setUTCDate(before.getUTCDate() + 1)
    for (let page = 1;; page++) {
      console.debug(`metrics/compute/${login}/plugins > isocalendar > loading gitlab events page ${page}`)
      const {data: events} = await imports.axios.get(`${url.replace(/\/$/, "")}/api/v4/events`, {
        headers: {"PRIVATE-TOKEN": token},
        params: {after: day(after), before: day(before), per_page: 100, page, sort: "asc"},
      })
      for (const event of events) {
        if (ignored.gitlab.includes(event.action_name))
          continue
        const value = count === "commits" ? (event.push_data?.commit_count ?? 0) : 1
        if (!value)
          continue
        const key = day(event.created_at)
        const entry = days.get(key) ?? {count: 0}
        entry.count += value
        days.set(key, entry)
      }
      if (events.length < 100)
        break
    }
    return days
  },
}
