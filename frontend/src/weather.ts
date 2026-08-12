// Client-side-only fetch to Open-Meteo (free, keyless) for the Home page's
// "Today at Cobb's" card. Deliberately not routed through api.ts's request()
// helper -- that helper targets our own backend's API_BASE_URL, while this
// hits a public third-party host directly.

export interface CurrentWeather {
  temperatureF: number
  description: string
  emoji: string
}

// WMO weather codes (https://open-meteo.com/en/docs), collapsed to the
// buckets this card actually needs to show.
function describeWeatherCode(code: number): { description: string; emoji: string } {
  if (code === 0) return { description: 'Clear sky', emoji: '☀️' }
  if (code <= 2) return { description: 'Partly cloudy', emoji: '⛅' }
  if (code === 3) return { description: 'Overcast', emoji: '☁️' }
  if (code === 45 || code === 48) return { description: 'Foggy', emoji: '🌫️' }
  if (code >= 51 && code <= 57) return { description: 'Drizzle', emoji: '🌦️' }
  if (code >= 61 && code <= 67) return { description: 'Rain', emoji: '🌧️' }
  if (code >= 71 && code <= 77) return { description: 'Snow', emoji: '🌨️' }
  if (code >= 80 && code <= 82) return { description: 'Rain showers', emoji: '🌧️' }
  if (code >= 85 && code <= 86) return { description: 'Snow showers', emoji: '🌨️' }
  if (code >= 95) return { description: 'Thunderstorm', emoji: '⛈️' }
  return { description: 'Unknown', emoji: '🌡️' }
}

export async function fetchCurrentWeather(latitude: number, longitude: number): Promise<CurrentWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo request failed: ${res.status}`)
  const data = await res.json()
  const temperatureF = data?.current?.temperature_2m
  const code = data?.current?.weather_code
  if (typeof temperatureF !== 'number' || typeof code !== 'number') {
    throw new Error('Open-Meteo response missing current weather fields')
  }
  const { description, emoji } = describeWeatherCode(code)
  return { temperatureF, description, emoji }
}
