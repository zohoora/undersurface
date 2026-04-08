import { WeatherEngine } from '../engine/weatherEngine'

let instance: WeatherEngine | null = null

export function getWeatherEngine(): WeatherEngine {
  if (!instance) instance = new WeatherEngine()
  return instance
}
