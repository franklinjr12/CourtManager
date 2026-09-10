import { getAppContext } from '../app/context.js';
import { formatDate, translateError } from '../i18n.js';
import {
  endIsoFromInputs as endIso,
  isoFromInputs as iso,
  localDateKey as dateKey,
  today as currentDay,
  timeValue as clockValue,
} from './dates.js';

export const today = () => currentDay(getAppContext().timezone);
export const isoFromInputs = (date: string, time: string, zone = getAppContext().timezone()) =>
  iso(date, time, zone);
export const endIsoFromInputs = (
  date: string,
  time: string,
  duration: number,
  zone = getAppContext().timezone(),
) => endIso(date, time, duration, zone);
export const timeValue = (date: string) =>
  clockValue(date, getAppContext().timezone());
export const localDateKey = (date: string) =>
  dateKey(date, getAppContext().timezone());
export const dateValue = (date: string) =>
  formatDate(new Date(date), getAppContext().timezone());
export const errorMessage = (error: unknown) => translateError(error);
