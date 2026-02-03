# CRO Analyst v3 — Case Study

## Overview

**CRO Analyst v3** is a production-grade web application designed to centralize, analyze, and make accessible A/B testing experiment data for conversion rate optimization teams. The platform transforms scattered experiment data into actionable insights through intelligent data visualization, natural language querying, and graph-based relationship analysis.

Built for **MVF (MyVoucherCodes)**, this application serves as the single source of truth for experiment tracking, enabling teams to quickly discover patterns, learn from past experiments, and make data-driven decisions about future tests.

## The Challenge

Before CRO Analyst v3, experiment data lived in disconnected spreadsheets, making it difficult to:
- **Track experiment outcomes** across different teams, verticals, and geographies
- **Identify winning patterns** that could be replicated across similar contexts
- **Answer questions quickly** without writing complex SQL queries
- **Understand relationships** between experiments, change types, and business metrics
- **Maintain data freshness** as new experiments concluded

The solution needed to be:
- **Accessible** to non-technical stakeholders (PMs, analysts)
- **Transparent** in its data sources and query logic
- **Scalable** to handle growing experiment volumes
- **Automated** to reduce manual data entry overhead

## Solution Architecture

### Core Features

#### 1. **Automated Data Ingestion**
- **Google Sheets Integration**: Automatically syncs experiment data from live Google Sheets
- **Scheduled Imports**: Daily cron jobs ensure data stays current without manual intervention
- **Manual Import Options**: Support for CSV uploads and on-demand sheet imports
- **Data Normalization**: Robust parsing and validation of dates, numbers, and text fields
- **Screenshot Management**: Automatic retrieval and storage of experiment screenshots from Google Drive

#### 2. **Intelligent Experiment Discovery**
- **Stats Dashboard**: Monthly overview with key metrics, top winners, and breakdowns by vertical/geo
- **Experiment Detail Pages**: Comprehensive views showing hypothesis, lessons learned, revenue impact, and visual evidence
- **Graph Visualization**: 3D interactive Neo4j graph showing relationships between experiments, change types, elements, and business dimensions
- **Similarity Matching**: AI-powered discovery of related experiments based on shared characteristics and outcomes

#### 3. **Natural Language Query Interface**
- **Ask AI Feature**: Query experiment data using plain English
- **Dual-Mode Querying**: Automatically routes questions to SQL (Postgres) for data queries or Cypher (Neo4j) for relationship queries
- **Transparent Results**: Shows generated queries and source data for full transparency
- **Safe Query Execution**: Built-in sanitization prevents SQL injection and enforces read-only access

#### 4. **Graph-Based Analytics**
- **Neo4j Integration**: Mirrors experiment data into a graph database for relationship analysis
- **Pattern Discovery**: Identifies connections between change types, UI elements, verticals, geographies, and outcomes
- **Visual Exploration**: Interactive 3D force-directed graphs powered by Three.js
- **Similar Experiment Recommendations**: Uses graph relationships to suggest related experiments

### Technical Stack

**Frontend:**
- Next.js 15 (App Router) with React 19
- TypeScript for type safety
- TailwindCSS for styling
- Three.js + react-force-graph-3d for 3D visualizations

**Backend & Data:**
- PostgreSQL with Prisma ORM (canonical data store)
- Neo4j Graph Database (relationship analysis)
- NextAuth.js for Google OAuth authentication
- OpenAI API for embeddings and LLM-powered query generation

**Infrastructure:**
- Vercel for hosting and serverless functions
- AWS RDS (PostgreSQL) for primary database
- Neo4j Cloud for graph database
- Vercel Cron for scheduled data imports
- Google Sheets API for data source
- Google Drive API for screenshot management

**Key Libraries:**
- Prisma for database management
- Neo4j Driver for graph queries
- CSV parsing for manual imports
- Vector embeddings for semantic search (optional)

## Technical Highlights

### 1. **Hybrid Database Architecture**

The application uses a dual-database approach:
- **PostgreSQL**: Stores the canonical experiment data with full schema, supporting complex queries and aggregations
- **Neo4j**: Maintains a graph mirror optimized for relationship traversal and pattern discovery

This architecture allows the system to leverage the strengths of both relational and graph databases, providing fast analytical queries while enabling rich relationship exploration.

### 2. **AI-Powered Query Generation**

The "Ask AI" feature uses LLM-based query generation with multiple safety layers:
- **Query Sanitization**: Validates SQL/Cypher queries before execution
- **Read-Only Enforcement**: Blocks any write operations
- **Automatic Mode Selection**: Intelligently chooses between SQL and graph queries based on question intent
- **Result Summarization**: Provides natural language summaries of query results
- **Transparency**: Always shows the generated query and source data

### 3. **Automated Data Pipeline**

The import system is designed for reliability and scalability:
- **Idempotent Imports**: Safe to run multiple times without duplicating data
- **Batch Processing**: Handles large datasets in manageable chunks
- **Error Recovery**: Gracefully handles partial failures
- **Progress Tracking**: Job state persisted in database for resumability

### 4. **Graph Similarity Algorithm**

The system uses a sophisticated algorithm to find similar experiments:
1. **Primary**: Uses explicit `SIMILAR_TO` relationships when available
2. **Fallback**: Calculates similarity based on overlap of:
   - Change types
   - UI elements modified
   - Vertical/geography/brand
   - Target metrics
3. **Ranking**: Orders by overlap score and monthly revenue extrapolation
4. **Limiting**: Returns top 6 most similar experiments

## User Experience

### Stats Dashboard
- Automatically selects the latest completed month with data
- Displays key metrics in card format: experiments run, concluded, launched
- Shows top winners by revenue impact
- Provides breakdowns by vertical and geography
- Features an interactive 3D graph visualization
- Paginated experiment table with filtering

### Experiment Detail Pages
- Complete experiment metadata
- Hypothesis and lessons learned
- Revenue impact calculations
- Screenshot gallery
- Links to external tools (e.g., Optimizely)
- Graph of similar experiments
- Context-aware navigation (remembers origin page)

### Ask AI Interface
- Simple text input for natural language questions
- Mode selection (Auto, SQL-only, Graph-only)
- Real-time query execution
- Expandable sections showing:
  - Generated SQL/Cypher queries
  - Source data tables
  - Visual graph representations (for graph queries)
- Clickable experiment links for easy navigation

## Security & Operations

### Authentication
- Google OAuth via NextAuth.js
- Optional email allowlist for access control
- Session-based authentication for manual imports

### API Security
- Internal API key for scheduled imports
- Service account tokens for Google API access
- Query sanitization prevents injection attacks
- Read-only query enforcement

### Monitoring
- Health check endpoint (`/api/health`)
- Database connectivity monitoring
- Error logging and tracking
- Vercel serverless function monitoring

## Impact & Results

### For Teams
- **Time Savings**: Reduced time to find experiment information from hours to seconds
- **Pattern Recognition**: Graph visualization reveals winning patterns across verticals and geographies
- **Knowledge Sharing**: Centralized repository of hypotheses and lessons learned
- **Data-Driven Decisions**: Easy access to historical performance data

### For Analysts
- **Query Transparency**: See exactly what queries are being run
- **No SQL Required**: Natural language interface makes data accessible
- **Relationship Discovery**: Graph analysis reveals unexpected connections
- **Reproducible Insights**: All queries and results are traceable

### For the Organization
- **Single Source of Truth**: Eliminates confusion from multiple data sources
- **Automated Updates**: Daily syncs ensure data freshness
- **Scalable Architecture**: Handles growing experiment volumes
- **Future-Proof**: Extensible design supports new features and integrations

## Key Learnings

1. **Dual Database Strategy**: Combining relational and graph databases provides both analytical power and relationship insights
2. **Transparency Builds Trust**: Showing generated queries increases user confidence in AI-powered features
3. **Automation Reduces Friction**: Scheduled imports eliminate manual data entry overhead
4. **Visualization Aids Discovery**: 3D graphs reveal patterns that tables cannot
5. **Safety First**: Multiple layers of query sanitization are essential for AI-generated code

## Future Enhancements

Potential areas for expansion:
- Vector embeddings for semantic search
- Advanced filtering and faceted search
- Experiment recommendation engine
- Automated insight generation
- Integration with additional experiment platforms
- Team collaboration features
- Custom dashboard creation

## Conclusion

CRO Analyst v3 demonstrates how modern web technologies, intelligent data architecture, and user-centered design can transform complex data into actionable insights. By combining automated data ingestion, graph-based analytics, and natural language querying, the platform makes experiment data accessible to everyone while maintaining the rigor and transparency that analysts require.

The project showcases expertise in:
- Full-stack Next.js development
- Database architecture (relational + graph)
- AI/LLM integration with safety considerations
- Data pipeline automation
- Interactive data visualization
- Production deployment and operations

---

**Technologies:** Next.js, React, TypeScript, PostgreSQL, Neo4j, Prisma, NextAuth, OpenAI API, Google APIs, Vercel, Three.js, TailwindCSS

**Role:** Full-stack Developer & Architect

**Timeline:** 2024-2025
