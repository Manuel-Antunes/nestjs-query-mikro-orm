# Contributing to nestjs-query-mikro-orm

Thank you for your interest in contributing to nestjs-query-mikro-orm! This document provides guidelines and instructions for contributing.

## Prerequisites

- Node.js >= 18
- pnpm >= 9
- Docker — the Neo4j specs start a test container. Set `NEO4J_URL` to reuse an instance you already
  have running and no container is started. MongoDB needs nothing: those specs use an in-process
  server.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/nestjs-query-mikro-orm.git`
3. Create a new branch: `git checkout -b feature/your-feature-name`
4. Install dependencies: `pnpm install`
5. Setup git hooks: `pnpm prepare`

## Development Workflow

### Making Changes

1. Make your changes in the `src/` directory
2. Add or update tests in `__tests__/` as needed
3. Run tests to ensure everything works: `pnpm test`
4. Run linting and formatting: `pnpm lint` and `pnpm format`
5. Build the project: `pnpm build`

### Available Scripts

```bash
# Build the library
pnpm build

# Build in watch mode
pnpm dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage
pnpm test:coverage

# Lint code
pnpm lint

# Fix lint issues
pnpm lint:fix

# Format code
pnpm format

# Check formatting
pnpm format:check

# Type check
pnpm typecheck

# Compare the aggregation strategies (skipped during a normal run)
pnpm bench
```

### Running against another database

The suite runs against SQLite by default. The same specs run against MongoDB, and the Neo4j specs
start their own container:

```bash
# Run the whole suite against MongoDB instead of SQLite
TEST_DRIVER=mongo pnpm test

# Point the Neo4j specs at an instance you already have, instead of starting a container
NEO4J_URL=bolt://127.0.0.1:7687 pnpm test
```

Specs that only make sense on one driver guard themselves with `describe.skipIf(IS_MONGO)`, so a
run against another database skips them rather than failing.

### Code Quality

Before committing, make sure your code passes all checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm typecheck` covers both `src/` and `__tests__/`, and `pnpm build` type-checks again while
emitting declarations — a change can pass one and fail the other, so run both.

## Git Hooks

This project uses Husky for git hooks:

- **pre-commit**: Runs lint-staged to format and lint staged files
- **pre-push**: Runs lint, typecheck, and tests before pushing
- **commit-msg**: Validates commit messages using commitlint

## Commit Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/). Your commit messages should be structured as follows:

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that don't affect code meaning (white-space, formatting, etc)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

### Examples

```
feat(query): add support for complex aggregations

fix(filter): handle null values in date filters correctly

docs: update README with new examples

test(services): add tests for relation query service
```

## Pull Request Process

1. Update the README.md with details of changes if applicable
2. Update tests to cover your changes
3. Ensure all tests pass and code quality checks succeed
4. Update the CHANGELOG.md if it's a significant change
5. The PR will be merged once you have the sign-off of at least one maintainer

## Code Style

- Use TypeScript for all code
- Follow the existing code style (enforced by ESLint and Prettier)
- Write clear, self-documenting code
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Write meaningful variable and function names

`@typescript-eslint/no-explicit-any` is an **error**, not a warning. When a cast is genuinely
unavoidable, narrow it to the smallest honest type and say in a comment why it is needed — an
`any` hides the type checking that would have caught the next bug.

## Testing Guidelines

- Write tests for all new features
- Ensure existing tests still pass
- Aim for high code coverage
- Use descriptive test names
- Follow the AAA pattern (Arrange, Act, Assert)

### Aggregation strategies

Aggregation is pluggable per backend, and every strategy has to answer the same question the same
way. Two suites enforce that:

- `__tests__/aggregate/conformance.spec.ts` — the single-entity contract
- `__tests__/aggregate/batch-conformance.spec.ts` — the batched relation contract

A new strategy becomes conformant by being added to `strategiesFor()` / `strategies()` in those
files and passing **without any existing assertion being changed**. If a test has to be relaxed to
accommodate it, the strategy is not interchangeable with the others yet.

Backends differ in what they hand back — SQLite reports a `MAX` over a datetime as epoch
milliseconds and a grouped boolean as `0`/`1`, MongoDB reports the same two as a `Date` and a
`boolean`. `normalizeAggregateRecords` is what reconciles them, so a strategy should return the
backend's own values rather than pre-converting.

## Questions?

If you have questions, feel free to:

- Open an issue for discussion
- Reach out to the maintainers

Thank you for contributing! 🎉
