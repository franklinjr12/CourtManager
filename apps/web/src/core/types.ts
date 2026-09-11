export type Session = {
  token: string;
  user: { userId: string; name: string; role: string };
  organization?: {
    name: string;
    timezone?: string;
    features?: { classes: boolean; finance: boolean };
  };
};

export type OpeningHours = Record<string, { open: string; close: string } | null>;

export type Organization = {
  organizationId: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  phone?: string;
  email?: string;
  preferredSportId?: string;
  active: boolean;
  features: { classes: boolean; finance: boolean };
};

export type Court = {
  courtId: string;
  name: string;
  sport: string;
  sportId?: string;
  active: boolean;
  publiclyRequestable: boolean;
  slotMinutes: 30 | 60;
  defaultHourlyPrice: number;
  openingHours: OpeningHours;
  notes?: string;
  archivedAt?: string;
};

export type Sport = { sportId: string; name: string; active: boolean };

export type Customer = {
  customerId: string;
  name: string;
  phone?: string;
  email?: string;
  archived: boolean;
  notes?: string;
  customerName?: string;
};

export type Reservation = {
  reservationId: string;
  courtId: string;
  customerId: string;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  expectedAmount: number;
  notes?: string;
  paidAmount?: number;
  remainingAmount?: number;
  paymentStatus?: string;
  chargeId?: string;
  customerName?: string;
  courtName?: string;
};

export type RequestItem = {
  requestId: string;
  courtId: string;
  requestedStartAt: string;
  requestedEndAt: string;
  customerName: string;
  phone: string;
  email?: string;
  notes?: string;
  status: string;
  linkedCustomerId?: string;
};

export type Payment = {
  paymentId: string;
  reservationId?: string;
  classId?: string;
  customerId: string;
  amount: number;
  method: string;
  paidAt: string;
  notes?: string;
};

export type SportClass = {
  classId: string;
  name: string;
  sport: string;
  coachId: string;
  courtId: string;
  capacity: number;
  price: number;
  pricePerParticipant?: number;
  type?: 'GROUP' | 'PRIVATE';
  scheduleType?: 'SINGLE' | 'WEEKLY';
  weekday: number;
  startTime: string;
  durationMinutes: number;
  startDate: string;
  endDate?: string;
  active: boolean;
  notes?: string;
};

export type ClassSession = {
  sessionId: string;
  classId: string;
  courtId: string;
  coachId: string;
  startAt: string;
  endAt: string;
  status: string;
  capacity: number;
};

export type ScheduleItem = Reservation & {
  blockId?: string;
  reason?: string;
  classId?: string;
  name?: string;
  occupancyType?: string;
};
