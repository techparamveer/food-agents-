import assert from "node:assert/strict";
import { attendeesFromCsv, parseCsv } from "@/lib/db/csv";

/* Attendee CSV import: parsing, header mapping and per-line errors. */

// Quotes, doubled quotes, commas and newlines inside quotes, CRLF and a BOM.
assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"multi\nline",z'), [
  ["a", "b"],
  ["x, y", 'say "hi"'],
  ["multi\nline", "z"],
]);
assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
assert.deepEqual(parseCsv("a,,c"), [["a", "", "c"]]);

// Header names are matched loosely; first + last name join; dietary words map to needs.
{
  const csv = [
    "First Name,Last Name,E-mail,Discord Username,Dietary Requirements,QR Hash",
    "Ada,Lovelace,ADA@Example.com,@ada.l,Vegetarian,",
    "Alan,Turing,alan@example.com,,gluten free,q_0123456789abcdef0123456789abcdef",
    ",,,,",
    "Grace,Hopper,,,none,",
  ].join("\n");
  const { rows, errors, columns } = attendeesFromCsv(csv);
  assert.deepEqual(errors, []);
  assert.deepEqual(columns, ["first", "last", "email", "discord", "dietary", "qr"]);
  assert.deepEqual(rows, [
    { line: 2, name: "Ada Lovelace", email: "ada@example.com", discord_handle: "ada.l", dietary: "veg" },
    { line: 3, name: "Alan Turing", email: "alan@example.com", dietary: "gf", qr_hash: "q_0123456789abcdef0123456789abcdef" },
    { line: 5, name: "Grace Hopper" },
  ]);
}

// Each bad row is reported with its file line; good rows still come through.
{
  const csv = [
    "name,email,dietary,qr",
    "Ok One,one@example.com,vegan,",
    ",nobody@example.com,,",
    "Bad Email,not-an-email,,",
    "Dup,ONE@example.com,,",
    "Keto Fan,,keto,",
    "Bad QR,,,ph_123",
    '"Quoted, Name",q@example.com,halal,ph_0000abcd',
    "Same QR,,,ph_0000abcd",
    "X".repeat(121) + ",,,",
  ].join("\n");
  const { rows, errors } = attendeesFromCsv(csv);
  assert.deepEqual(
    rows.map((r) => [r.line, r.name]),
    [
      [2, "Ok One"],
      [8, "Quoted, Name"],
    ],
  );
  assert.deepEqual(
    errors.map((e) => e.line),
    [3, 4, 5, 6, 7, 9, 10],
  );
  assert.equal(errors[0].error, "Name is required");
  assert.match(errors[1].error, /Invalid email/);
  assert.match(errors[2].error, /Duplicate email \(also on line 2\)/);
  assert.match(errors[3].error, /Unknown dietary need "keto"/);
  assert.equal(errors[4].error, "Invalid QR hash");
  assert.match(errors[5].error, /Duplicate QR hash \(also on line 8\)/);
  assert.match(errors[6].error, /1–120/);
}

// A quoted field spanning lines keeps later line numbers right.
{
  const { rows } = attendeesFromCsv('name,email\n"Two\nLines",a@example.com\nNext,b@example.com');
  assert.deepEqual(
    rows.map((r) => r.line),
    [2, 4],
  );
}

// Files it can't use at all.
assert.throws(() => attendeesFromCsv(""), /empty/);
assert.throws(() => attendeesFromCsv("email,discord\na@b.co,x"), /name/);
assert.throws(() => attendeesFromCsv("name\n" + "x\n".repeat(5001)), /5,000/);

console.log("test-csv: ok");
