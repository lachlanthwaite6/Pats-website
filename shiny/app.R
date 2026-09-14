# Optional local R/Shiny companion. Cloudflare serves the JS dashboard, not this app.
# install.packages(c("shiny", "jsonlite"))
# From repository root: shiny::runApp("shiny", host="127.0.0.1")
library(shiny)
library(jsonlite)
source_file <- Sys.getenv("DASHBOARD_SNAPSHOT", unset = "../private/snapshot.json")
if (!file.exists(source_file)) stop("Import the workbook first or set DASHBOARD_SNAPSHOT to an absolute snapshot.json path")
snapshot <- fromJSON(source_file)
ui <- fluidPage(
  titlePanel("Flipped Energy · R analysis companion"),
  p("Local workbook snapshot. The hosted dashboard runs independently on Cloudflare."),
  selectInput("network", "Network", c("All", sort(unique(snapshot$plans$network)))),
  selectInput("book", "Book", c("All", "Front-Book", "Back-Book")),
  plotOutput("trend", height = 250),
  tableOutput("plans")
)
server <- function(input, output, session) {
  output$trend <- renderPlot({
    x <- as.Date(snapshot$trend$week)
    matplot(x, cbind(snapshot$trend$wins, snapshot$trend$losses), type = "l",
            lty = 1, col = c("#087e8a", "#b74755"), xlab = "Week", ylab = "Events")
    legend("topleft", c("Sign-ups", "Churn"), col = c("#087e8a", "#b74755"), lty = 1, bty = "n")
  })
  output$plans <- renderTable({
    rows <- snapshot$plans
    if (input$network != "All") rows <- rows[rows$network == input$network, ]
    if (input$book != "All") rows <- rows[rows$book == input$book, ]
    head(rows[, c("code", "network", "book", "customers", "recentSignups", "status")], 30)
  })
}
shinyApp(ui, server)
