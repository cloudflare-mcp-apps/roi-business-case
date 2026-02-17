export const SERVER_INSTRUCTIONS = `
# ROI Business Case Builder MCP Server

## Capabilities
- Interactive ROI business case calculator for B2B sales (Wise Selling System)
- Dynamic sliders for 1-5 client problems, solution costs, and expected effects
- Real-time ROI%, payback period, and cost comparison visualization
- Formatted business case text ready to send to clients

## Tools Overview
- **build_business_case**: Builds interactive ROI calculator from client problem costs, solution pricing, and expected effects. Returns financial metrics + interactive widget with charts.
- **recalculate_roi**: Internal widget tool for slider recalculation (not visible to model).

## Usage Guidelines
- Use build_business_case when: user describes client problems and solution costs, asks for ROI calculation, needs a business case for a meeting
- Extract problem costs, solution pricing, and effects from the user's natural language description
- Tag each cost as "client" (confirmed by client) or "estimate" (salesperson's assumption)
- All monetary values are in PLN (Polish Zloty)

## Performance Characteristics
- Tool execution: < 200ms (pure math, no external API)
- Widget: real-time slider interaction, no server roundtrip needed

## Example Queries
"Zbuduj business case dla Fabryki Metali. Traca 150k na reklamacjach i 80k na przestojach. Nasze wdrozenie kosztuje 60k + 30k rocznie." -> Use build_business_case
"Kalkulacja ROI: problem kosztuje klienta 500k rocznie, nasze rozwiazanie 120k jednorazowo + 40k rocznie" -> Use build_business_case with 1 problem, 1 effect
"Pokaz kalkulator ROI" -> Use build_business_case with demo data
`.trim();
