# Public booking flow

`GET /public/venues/:slug` returns only public venue and court information. `GET /public/venues/:slug/availability` returns free start times. `POST /public/venues/:slug/requests` validates the court, opening hours, duration, future timestamp, and contact information, then stores `REQUESTED` without reserving the court.

Staff review the inbox and confirm or reject. Confirmation creates a customer when needed, revalidates and locks the requested slot, creates a reservation, and links it to the request. The public response never contains customer names, occupancy reasons, employee details, or financial data.
