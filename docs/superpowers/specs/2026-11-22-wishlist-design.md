# Wishlist (release 1: on this device)

**Why.** Customers browse on a phone, see something they like, and are not ready to buy. They need somewhere light to keep it, without logging in.

**Goals.** A heart on product cards and the product page. A `/wishlist` page. A heart with a count in the header. Works for guests, in a normal browser and in the Telegram Mini App.

**Non-goals.** No account sync, no database table, no API change, no sharing, no price-drop alerts, no new product fields.

**Approaches.** (A) this device only, (B) account only, (C) both with a merge on login. Chosen: A first, because it ships today with no schema change; C builds on it later by adding a server list and merging the device list at login. Their pick: "go with your pick".

**Design.**
- Store: ids only, newest first, in the browser (`cs_wishlist_v1`), at most 50 (the by-ids endpoint's limit; the oldest drops). Same safe storage as the cart.
- Page: loads the saved ids with `GET /products/by-ids`, shows them as product cards (so Add to cart works), drops ids that no longer exist with a one-line notice. A sold-out item stays and shows Sold out.
- Phones: the heart sits in the header (the bottom bar is full).
- Strings in English and Khmer.

**Builder's calls.** Heart is red when saved; a toast only when adding; no toast when removing.
