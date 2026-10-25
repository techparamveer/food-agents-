import { initialsAvatar } from "@/lib/avatar";
import { placeholderHash } from "@/lib/qr";
import type { Attendee, Dietary } from "@/lib/types";

/* OxHack attendees: fictional students with mock Discord handles, generated avatars and
   placeholder QR hashes. Fifty first and fifty last names, paired so no name repeats. */

const FIRST = [
  "Amara", "Ben", "Chloe", "Dev", "Ella", "Femi", "Grace", "Hamza", "Isla", "Jun",
  "Kai", "Leah", "Musa", "Nina", "Omar", "Priya", "Rory", "Sofia", "Tom", "Yusuf",
  "Zara", "Aditya", "Bea", "Callum", "Daniela", "Ethan", "Fatima", "George", "Hana", "Ibrahim",
  "Jess", "Kwame", "Lucy", "Mateo", "Niamh", "Oliver", "Pooja", "Qasim", "Rosie", "Sam",
  "Tariq", "Uma", "Vikram", "Wen", "Xavier", "Yasmin", "Zoe", "Arjun", "Imogen", "Kofi",
];

const LAST = [
  "Ahmed", "Brown", "Chen", "Davies", "Evans", "Fraser", "Gupta", "Hughes", "Iqbal", "Jones",
  "Khan", "Li", "Murphy", "Nguyen", "Okafor", "Patel", "Quinn", "Robinson", "Singh", "Taylor",
  "Usman", "Varga", "Wilson", "Xu", "Yilmaz", "Zhang", "Adeyemi", "Byrne", "Campbell", "Dhillon",
  "Edwards", "Fernandes", "Green", "Hassan", "Ibrahim", "Jackson", "Kowalski", "Lewis", "Mensah", "Novak",
  "O'Brien", "Park", "Rahman", "Shah", "Thompson", "Walker", "Wright", "Yamamoto", "Ali", "Morgan",
];

/** Mock Discord usernames in the styles people actually pick. */
function handleFor(first: string, last: string, i: number) {
  const f = first.toLowerCase();
  const l = last.toLowerCase().replace(/[^a-z]/g, "");
  switch (i % 6) {
    case 0:
      return `${f}${l}`;
    case 1:
      return `${f}.${l}`;
    case 2:
      return `${f}_${l[0]}`;
    case 3:
      return `${f}${(i * 7) % 100}`;
    case 4:
      return `${l}.${f[0]}`;
    default:
      return `x${f}x`;
  }
}

/** Spreads the event's dietary mix over the list: 23 veg, 12 vegan, 6 halal, 5 gluten-free. */
function dietaryFor(i: number): Dietary | undefined {
  const r = (i * 37) % 150;
  if (r < 23) return "veg";
  if (r < 35) return "vegan";
  if (r < 41) return "halal";
  if (r < 46) return "gf";
  return undefined;
}

export function seedAttendees(count: number): Attendee[] {
  return Array.from({ length: count }, (_, i) => {
    const first = FIRST[i % FIRST.length];
    // Each pass over FIRST shifts the surname, so every pairing is unique for up to 150 people.
    const last = LAST[(i * 7 + Math.floor(i / FIRST.length) * 3) % LAST.length];
    const id = `att-${String(i + 1).padStart(3, "0")}`;
    const name = `${first} ${last}`;
    return {
      id,
      name,
      discordHandle: handleFor(first, last, i),
      avatarUrl: initialsAvatar(name),
      qrHash: placeholderHash(id),
      dietary: dietaryFor(i),
    };
  });
}
