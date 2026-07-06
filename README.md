# DB Compare

Comparison of database schemas `MSSQL` ↔ `PostgreSQL` | `MSSQL` ↔ `MSSQL` | `PostgreSQL` ↔ `PostgreSQL`

## Run

* On your keyboard press
  * mac: `⌘ + ⇧ + P` 
  * win: `Ctrl + Shift + P`
* Type `DB Compare: Open`

## General Description

A Visual Studio Code extension that helps you compare the structure of two databases and shows the differences in a clear table format.

**Supported databases:**

- Microsoft SQL Server (MSSQL)
- PostgreSQL

You can compare any pair:

- `MSSQL` ↔ `MSSQL`
- `PostgreSQL` ↔ `PostgreSQL`
- `MSSQL` ↔ `PostgreSQL`

This tool is very useful for database migrations, replication, change audits, and syncing environments (development / testing / production).

### Connection strings

#### postgre

postgresql://reader:NWDMCE5xdipIjRrp@hh-pgsql-public.ebi.ac.uk:5432/pfmegrnargs

#### mssql

Server=myserverhost_or_ip;Database=myDbName;User Id=JohnDoe;Password=mySecretPassword;TrustServerCertificate=True;Encrypt=True;

## How is it different from other tools?

**Simple and native** – No need to install extra programs or agents. Everything works inside VS Code using the `mssql` and `pg` drivers.

**Flexible filters** – You can easily hide temporary tables, test schemas, or other objects using regular expressions.

**Caching** – After the first comparison, the metadata is saved on your computer. Next time it runs very fast — in just a few seconds.

**Easy interface** – Two display modes (detailed and grouped), and colors to show differences (pink = missing, yellow = small differences in properties).

**Works offline** – After loading the cache, you can view results even without connecting to the database.

Unlike big paid tools (like Redgate or ApexSQL), this is a lightweight, free extension that solves 90% of everyday schema comparison tasks.

### Schema Mapping

**Why do we need schema mapping?**

In different databases, the same logical schema can have different names:

- In MSSQL — often `dbo`
- In PostgreSQL — usually `public`

If you compare databases without mapping, the tool may think objects are different just because the schema names don't match.

Schema mapping lets you create rules to match them:

`dbo` → `DBO`  
`ora_dbo` → `DBO`  
`public` → `PUBLIC`

After mapping, objects with different schema names will be correctly compared. The rules are saved and work between VS Code sessions.

### Type Normalization

Different databases use different names for similar data types:

- `int` (MSSQL) ↔ `integer` (PostgreSQL)
- `varchar(255)` ↔ `character varying(255)`
- `bit` ↔ `boolean`

The extension can automatically normalize these types to a common form:

- Integer types → `dword`, `qword`, `word`
- String types → `string(N)`, `fixedstring(N)`, `string(MAX)`
- Date/time → `date`, `time`, `datetime`
- Binary → `binary(N)`, `binary(MAX)`

This helps compare columns at a logical level, ignoring small syntax differences.

**Important**: You can turn normalization on or off with a checkbox. If you want to see the original types, just disable it.

### Filters (Excluding Temporary Objects)

Big databases often have many temporary tables:

`.*#tmp_123e4567-e89b-12d3-a456-426614174000.*`  
`.*_temp_2025_03_15.*`  
`.*tbl_Backup_.*`

These objects make the comparison messy and slow.

Filters help you control what you see:

- **Include filters** (OR) – Show only objects that match these rules.
- **Exclude filters** (OR) – Hide objects that match these rules.

Example of useful exclude rules for temporary tables:

```
.*#tmp_.*
.*temp.*
.*tbl_Backup_.*
.*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$
```

**Tip**: Use include filters to check only specific schemas, and exclude filters to remove "garbage".

### Caching and Export

After the first comparison, all metadata is saved in a local cache. Future comparisons with the same connection strings are very fast.

You can see all saved caches on the **Cache** tab. You can:

- Delete a cache for a specific database pair
- Export a cache to a JSON file

#### Import of other users' caches (planned)

We are planning to add the ability to import caches from other people. This will allow:

- Sharing comparison results without giving database access
- Comparing your schema with a "golden standard"
- Code reviews without connecting to production

This feature is under discussion and will be added in a future version.

### Conclusion

`DB Compare` is a lightweight, fast, and flexible tool for comparing database schemas. It helps developers and administrators with everyday tasks.

If you work with MSSQL and PostgreSQL, this extension will save you many hours of manual work.

## License

MIT
