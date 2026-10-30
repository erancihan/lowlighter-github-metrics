//Imports
import * as sources from "./sources.mjs"

//Setup
export default async function({login, data, graphql, q, imports, queries, account}, {enabled = false, extras = false} = {}) {
  //Plugin execution
  try {
    //Check if plugin is enabled and requirements are met
    if ((!q.isocalendar) || (!imports.metadata.plugins.isocalendar.enabled(enabled, {extras})))
      return null

    //Load inputs
    let {duration, sources: _sources} = imports.metadata.plugins.isocalendar.inputs({data, account, q})

    //Compute start day
    const now = new Date()
    const start = new Date(now)
    if (duration === "full-year")
      start.setUTCFullYear(now.getUTCFullYear() - 1)
    else
      start.setUTCHours(-180 * 24)

    //Ensure start day is a sunday, and that time is set to 00:00:00.000
    if (start.getUTCDay())
      start.setUTCHours(-start.getUTCDay() * 24)
    start.setUTCMilliseconds(0)
    start.setUTCSeconds(0)
    start.setUTCMinutes(0)
    start.setUTCHours(0)

    //Load contributions from external sources
    const external = await sources.load({login, sources: _sources, start, end: now, imports})

    //Compute contribution calendar, highest contributions in a day, streaks and average commits per day
    console.debug(`metrics/compute/${login}/plugins > isocalendar > computing stats`)
    const calendar = {weeks: []}
    const {streak, max, average} = await statistics({login, graphql, queries, start, end: now, calendar, external})
    const reference = Math.max(...calendar.weeks.flatMap(({contributionDays}) => contributionDays.map(({contributionCount}) => contributionCount)))

    //Compute SVG
    console.debug(`metrics/compute/${login}/plugins > isocalendar > computing svg render`)
    const size = 6
    let i = 0, j = 0
    let svg = `
            <svg version="1.1" xmlns="http://www.w3.org/2000/svg" style="margin-top: -130px;" viewBox="0,0 480,${duration === "full-year" ? 270 : 170}">
              ${
      [1, 2].map(k => `
                <filter id="brightness${k}">
                  <feComponentTransfer>
                    ${[..."RGB"].map(channel => `<feFunc${channel} type="linear" slope="${1 - k * 0.4}" />`).join("")}
                  </feComponentTransfer>
                </filter>`)
        .join("")
    }
              <g transform="scale(4) translate(12, 0)">`
    //Iterate through weeks
    for (const week of calendar.weeks) {
      svg += `<g transform="translate(${i * 1.7}, ${i})">`
      j = 0
      //Iterate through days
      for (const day of week.contributionDays) {
        const ratio = (day.contributionCount / reference) || 0
        svg += `
                    <g transform="translate(${j * -1.7}, ${j + (1 - ratio) * size})">
                      <path fill="${day.color}" d="M1.7,2 0,1 1.7,0 3.4,1 z" />`
        //Stack each source contribution on sides
        let offset = 0
        for (const {color, contributionCount} of day.sources) {
          const height = ((contributionCount / reference) || 0) * size
          if (!height)
            continue
          svg += `
                      <path fill="${color}" filter="url(#brightness1)" d="M0,${1 + offset} 1.7,${2 + offset} 1.7,${2 + offset + height} 0,${1 + offset + height} z" />
                      <path fill="${color}" filter="url(#brightness2)" d="M1.7,${2 + offset} 3.4,${1 + offset} 3.4,${1 + offset + height} 1.7,${2 + offset + height} z" />`
          offset += height
        }
        svg += `
                    </g>`
        j++
      }
      svg += "</g>"
      i++
    }
    svg += "</g></svg>"

    //Results
    return {streak, max, average, svg, duration, sources: [{name: "github"}, ...external.map(({name, color}) => ({name, color}))]}
  }
  //Handle errors
  catch (error) {
    throw imports.format.error(error)
  }
}

/**Compute max and current streaks */
async function statistics({login, graphql, queries, start, end, calendar, external}) {
  let average = 0, max = 0, streak = {max: 0, current: 0}, values = []
  //Load contribution calendar
  for (let from = new Date(start); from < end;) {
    //Set date range
    let to = new Date(from)
    to.setUTCHours(+4 * 7 * 24)
    if (to > end)
      to = end
    //Ensure that date ranges are not overlapping by setting it to previous day at 23:59:59.999
    const dto = new Date(to)
    dto.setUTCHours(-1)
    dto.setUTCMinutes(59)
    dto.setUTCSeconds(59)
    dto.setUTCMilliseconds(999)
    //Fetch data from api
    console.debug(`metrics/compute/${login}/plugins > isocalendar > loading calendar from "${from.toISOString()}" to "${dto.toISOString()}"`)
    const {user: {calendar: {contributionCalendar: {weeks}}}} = await graphql(queries.isocalendar.calendar({login, from: from.toISOString(), to: dto.toISOString()}))
    calendar.weeks.push(...weeks)
    //Set next date range start
    from = new Date(to)
  }
  //Merge external sources contributions (matched by date)
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      day.sources = [{name: "github", color: day.color, contributionCount: day.contributionCount}]
      for (const {name, days} of external) {
        const {count: contributionCount = 0, color} = days.get(day.date) ?? {}
        if (contributionCount)
          day.sources.push({name, color, contributionCount})
      }
      day.contributionCount = day.sources.reduce((total, {contributionCount}) => total + contributionCount, 0)
      //Top face uses color of the source with most contributions
      day.color = day.sources.reduce((top, source) => source.contributionCount > top.contributionCount ? source : top).color
    }
  }
  //Compute streaks
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      values.push(day.contributionCount)
      max = Math.max(max, day.contributionCount)
      streak.current = day.contributionCount ? streak.current + 1 : 0
      streak.max = Math.max(streak.max, streak.current)
    }
  }
  //Compute average
  average = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2).replace(/[.]0+$/, "")
  return {streak, max, average}
}
