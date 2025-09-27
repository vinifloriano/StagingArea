using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using System.IO;
using StagingArea.Api.Data;
using StagingArea.Api.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// DbContext and services
builder.Services.AddDbContext<StagingDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
    options.UseSqlServer(connectionString);
});
builder.Services.AddScoped<IImportService, ImportService>();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod());
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors("AllowAll");

// Serve frontend static files from ../frontend
var frontendPath = Path.Combine(app.Environment.ContentRootPath, "..", "frontend");
if (Directory.Exists(frontendPath))
{
    app.UseDefaultFiles(new DefaultFilesOptions
    {
        FileProvider = new PhysicalFileProvider(frontendPath)
    });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(frontendPath)
    });
}

// Ensure database exists
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<StagingDbContext>();
    db.Database.EnsureCreated();
}

// Minimal API endpoints
app.MapPost("/api/import/customers", async (IImportService service) =>
{
    var result = await service.ImportCustomersFromSourceAsync();
    return Results.Ok(result);
});

app.MapPost("/api/import/orders", async (IImportService service) =>
{
    var result = await service.ImportOrdersFromSourceAsync();
    return Results.Ok(result);
});

app.MapGet("/api/staging/customers", async (StagingDbContext db) =>
{
    var data = await db.StagingCustomers
        .OrderByDescending(s => s.CreatedAtUtc)
        .Take(500)
        .ToListAsync();
    return Results.Ok(data);
});

app.MapGet("/api/staging/orders", async (StagingDbContext db) =>
{
    var data = await db.StagingOrders
        .OrderByDescending(s => s.CreatedAtUtc)
        .Take(500)
        .ToListAsync();
    return Results.Ok(data);
});

app.MapGet("/api/staging/customer-orders", async (StagingDbContext db) =>
{
    var joined = await db.StagingOrders
        .Join(db.StagingCustomers,
            o => o.CustomerExternalId,
            c => c.ExternalId,
            (o, c) => new
            {
                o.ExternalId,
                o.OrderDateUtc,
                o.TotalAmount,
                CustomerName = c.Name,
                c.Email
            })
        .OrderByDescending(x => x.OrderDateUtc)
        .Take(500)
        .ToListAsync();
    return Results.Ok(joined);
});

app.Run();
