namespace GSM3.Services;

using Microsoft.Extensions.DependencyInjection;

public static class ServiceLocator
{
    private static IServiceProvider? _provider;

    public static void Initialize(IServiceProvider provider) => _provider = provider;

    public static T GetService<T>() where T : class =>
        _provider?.GetRequiredService<T>() ?? throw new InvalidOperationException("ServiceLocator not initialized");

    public static T? TryGetService<T>() where T : class => _provider?.GetService<T>();
}
